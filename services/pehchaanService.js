// backend/services/pehchaanService.js
//
// UIDAI Aadhaar App Intent Integration — Specification v2 (17-Apr, "Implemented").
// Implements the Web-to-App and Cross-Device QR invocation methods for
// freelancer identity verification.
//
//   1. buildRequestJwt()  - mint an RS256-signed Intent Request JWT (§3.1)
//   2. invocation         - Web-to-App intent URL (§3.2.2) or QR Base10 (§3.2.3)
//   3. verifyCallback()   - verify signature + disclosure hashes (§3.4), persist
//   4. getStatus()        - polled by the browser until status flips
//
// Pending transactions live in MongoDB (AadhaarVerification, status:'pending'),
// NOT in an in-process Map: the UIDAI callback can land on a different instance
// than the one that served /init, and a restart must not strand a resident
// mid-verification.
//
// SECURITY (§3.7)
//   - RSA private key stays in the backend, read once at boot.
//   - exp is short lived (5 minutes, per §3.1.3).
//   - txn and jti are unique-indexed; replayed transactions are rejected.
//   - The raw SD-JWT credential is never persisted or logged.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const AadhaarVerification = require('../models/AadhaarVerification');
const StaffingPartner = require('../models/StaffingPartner');
const {
  formatPhotoUrl,
  normalizeGender,
  maskAadhaar,
  normalizeAddress,
  namesLooselyMatch
} = require('../utils/aadhaarPhotoHelper');

// ============================================================================
// Configuration
// ============================================================================

// §3.1.3: "Set to short expiry, recommended 5 minutes."
const TTL_SECONDS = parseInt(process.env.PEHCHAAN_REQUEST_TTL || '300', 10);

// §3.1.5 Language Mapping Table. 23 = English (the spec's default).
const LANG_ENGLISH = '23';

/**
 * §3.1.4 Complete Bitmap Mapping — bit position (1-indexed) to claim name.
 * Bits 41-42 are padding, "Reserved for future use. Must be set to 0".
 *
 * NOTE: there is NO Aadhaar-number claim in this table, masked or otherwise.
 * The Intent flow proves identity by face authentication and returns KYC
 * attributes only; it never returns the UID. Anything expecting a masked
 * Aadhaar number back from this flow will get nothing.
 */
const BITMAP_CLAIMS = {
  credentialIssuingDate: 1,
  enrolmentDate: 2,
  enrolmentNumber: 3,
  isNRI: 4,
  residentImage: 5,
  residentName: 6,
  localResidentName: 7,
  ageAbove18: 8,
  ageAbove50: 9,
  ageAbove60: 10,
  ageAbove75: 11,
  dob: 12,
  gender: 13,
  careOf: 14,
  localCareOf: 15,
  building: 16,
  localBuilding: 17,
  locality: 18,
  localLocality: 19,
  street: 20,
  localStreet: 21,
  landmark: 22,
  localLandmark: 23,
  vtc: 24,
  localVtc: 25,
  subDistrict: 26,
  localSubDistrict: 27,
  district: 28,
  localDistrict: 29,
  state: 30,
  localState: 31,
  poName: 32,
  localPoName: 33,
  pincode: 34,
  address: 35,
  regionalAddress: 36,
  mobile: 37,
  maskedMobile: 38,
  email: 39,
  maskedEmail: 40
};

const BITMAP_LENGTH = 42;

/**
 * Exactly the attributes this feature stores — data minimisation (§3.7 spirit).
 * Deliberately excludes enrolmentNumber, mobile and email: we do not need them,
 * so we do not ask for them.
 */
const REQUESTED_CLAIMS = ['residentImage', 'residentName', 'dob', 'gender', 'address', 'pincode'];

/**
 * Build the `sc` bitmap string.
 *
 * §3.1.4 says "You must always construct a 42 bit string" and lists 40 claims
 * plus 2 padding bits. (The example value in §3.1.2 is 43 characters long,
 * which contradicts the prose — we follow the prose and the table.)
 *
 * @param {string[]} claimNames
 * @returns {string} 42-character string of '0'/'1'
 */
function buildBitmap(claimNames = REQUESTED_CLAIMS) {
  const bits = new Array(BITMAP_LENGTH).fill('0');
  for (const name of claimNames) {
    const pos = BITMAP_CLAIMS[name];
    if (!pos) throw new Error(`[pehchaan] unknown bitmap claim: ${name}`);
    bits[pos - 1] = '1';
  }
  return bits.join('');
}

// Allow an override only as an escape hatch if UIDAI revises the mapping.
const SC_BITMAP = process.env.PEHCHAAN_BITMAP || buildBitmap();

let _privateKey = null;
let _uidaiPublicKey = null;

/**
 * PEM is whitespace-sensitive on its armor lines: a file copied out of an email
 * or a PDF often arrives with the BEGIN/END lines indented, and every parser
 * then rejects it. Strip leading/trailing space per line and normalise CRLF.
 */
function normalisePem(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim() + '\n';
}

function loadKey(envVar, label) {
  const keyPath = process.env[envVar];
  if (!keyPath) {
    throw new Error(`[pehchaan] ${envVar} is not set - cannot ${label}.`);
  }
  const resolved = path.isAbsolute(keyPath)
    ? keyPath
    : path.resolve(process.cwd(), keyPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`[pehchaan] ${label} key not found at ${resolved} (${envVar}).`);
  }

  const raw = fs.readFileSync(resolved, 'utf8');
  if (!raw.trim()) {
    throw new Error(
      `[pehchaan] ${label} key file is empty: ${resolved} (${envVar}).`
    );
  }
  return normalisePem(raw);
}

/**
 * UIDAI may supply its verification key either as a bare public key or as an
 * X.509 certificate (.cer/.crt contents). Node's createPublicKey() rejects a
 * CERTIFICATE block outright, so extract the embedded public key in that case.
 *
 * @param {string} pem
 * @returns {string|import('crypto').KeyObject}
 */
function toPublicKey(pem) {
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) return pem;

  try {
    return new crypto.X509Certificate(pem).publicKey;
  } catch (error) {
    throw new Error(
      `[pehchaan] could not read the public key from the supplied certificate: ${error.message}`
    );
  }
}

function getPrivateKey() {
  if (!_privateKey) _privateKey = loadKey('PEHCHAAN_PRIVATE_KEY_PATH', 'sign the Intent Request JWT');
  return _privateKey;
}

function getUidaiPublicKey() {
  if (!_uidaiPublicKey) {
    _uidaiPublicKey = toPublicKey(
      loadKey('PEHCHAAN_UIDAI_PUBLIC_KEY_PATH', 'verify the UIDAI credential')
    );
  }
  return _uidaiPublicKey;
}

/**
 * The two values UIDAI issues on OVSE approval (spec §2.2).
 *
 * OVSE_* is the preferred naming because it matches the spec's own wording;
 * PEHCHAAN_* is accepted as a fallback so an older env file keeps working.
 */
function ovseClientId() {
  return process.env.OVSE_CLIENT_ID || process.env.PEHCHAAN_CLIENT_ID || '';
}

function ovseRegistrationNo() {
  return process.env.OVSE_REGISTRATION_NO || process.env.PEHCHAAN_SA || '';
}

/** True when every credential needed for a live verification is configured. */
function isConfigured() {
  return Boolean(
    ovseClientId() &&                      // -> ac
    ovseRegistrationNo() &&                // -> sa
    process.env.PEHCHAAN_CALLBACK_URL &&   // -> cb
    process.env.PEHCHAAN_PRIVATE_KEY_PATH &&
    process.env.PEHCHAAN_UIDAI_PUBLIC_KEY_PATH
  );
}

// ============================================================================
// §3.1 - Intent Request JWT
// ============================================================================

/**
 * §3.1.3: `aud` is "URL (domain only)" and "Must equal callback domain".
 */
function audienceFromCallback(cb) {
  const url = new URL(cb);
  return `${url.protocol}//${url.host}`;
}

/**
 * Build the signed Intent Request JWT for one transaction.
 *
 * @param {object} opts
 * @param {'web'|'qr'|'app'} opts.channel  must match the invocation method (§3.1.3 `ch`)
 * @param {string}  opts.txnId
 * @param {string}  opts.jti
 * @param {string} [opts.hint]   resident name, used as `ht` profile hint
 * @param {number} [opts.ttl]
 * @returns {string} signed JWT
 */
function signIntentRequest({ channel, txnId, jti, hint, ttl = TTL_SECONDS }) {
  const callbackUrl = process.env.PEHCHAAN_CALLBACK_URL;
  const issuedAt = Math.floor(Date.now() / 1000);

  const payload = {
    txn: txnId,
    i: 'credential',                                  // §3.1.3 literal
    lang: process.env.PEHCHAAN_LANG || LANG_ENGLISH,
    sc: SC_BITMAP,
    pop: 1,                                           // face authentication required
    ch: channel,                                      // must match invocation method
    m: '1',                                           // online authentication
    ac: ovseClientId(),                               // OVSE Client ID
    sa: ovseRegistrationNo(),                         // OVSE Registration number
    cb: callbackUrl,
    aud: audienceFromCallback(callbackUrl),
    iss: process.env.PEHCHAAN_ISS || 'https://uidai.gov.in',
    exp: issuedAt + ttl,
    iat: issuedAt,
    ht: hint || null,                                 // profile hint, nullable
    aid: null,                                        // App-to-App only
    asig: null,                                       // App-to-App only
    jti
  };

  // §3.1.1 - header is exactly {alg, typ}. No kid.
  // Do NOT pass noTimestamp: jsonwebtoken deletes payload.iat when it is set,
  // and §3.1.3 marks iat mandatory. Without it, the explicit iat above is
  // honoured and left in place.
  return jwt.sign(payload, getPrivateKey(), {
    algorithm: 'RS256',
    header: { alg: 'RS256', typ: 'JWT' }
  });
}

/**
 * §3.2.2 Web to App — Android intent URL, fired with window.location.replace().
 */
function buildWebIntentUrl(requestJwt) {
  return (
    'intent:#Intent;action=in.gov.uidai.pehchaan.WEB_INTENT_REQUEST;S.request=' +
    requestJwt +
    ';end'
  );
}

/**
 * §3.2.3 Cross Device QR — encode the signed JWT for the QR payload.
 *
 * Steps, verbatim from the spec:
 *   1. Sign JWT  2. Encode ISO-8859-1  3. Append delimiter 255
 *   4. Gzip compress  5. Convert to BigInt  6. Convert to Base10
 *   7. Prefix https://maadhaar.com/getIntent?value=<BASE10>
 */
function buildCrossDeviceQrValue(requestJwt) {
  const bytes = Buffer.from(requestJwt, 'latin1'); // ISO-8859-1
  const withDelimiter = Buffer.concat([bytes, Buffer.from([255])]);
  const compressed = zlib.gzipSync(withDelimiter);

  let big = 0n;
  for (const byte of compressed) big = (big << 8n) | BigInt(byte);

  return `https://maadhaar.com/getIntent?value=${big.toString(10)}`;
}

/**
 * Create a Pehchaan verification transaction for a freelancer.
 *
 * @param {object}  opts
 * @param {object}  opts.partner   StaffingPartner document
 * @param {object}  opts.user      User document
 * @param {'web'|'qr'} opts.channel
 * @param {string} [opts.ip]
 * @returns {Promise<{txnId, intentUrl, qrValue, expiresAt, channel}>}
 */
async function buildRequestJwt({ partner, user, channel = 'web', ip }) {
  if (!isConfigured()) {
    const err = new Error(
      'Aadhaar verification is not configured on this server. ' +
      'Set the PEHCHAAN_* environment variables and key paths.'
    );
    err.code = 'PEHCHAAN_NOT_CONFIGURED';
    throw err;
  }

  if (!['web', 'qr', 'app'].includes(channel)) {
    throw new Error(`Unsupported invocation channel: ${channel}`);
  }

  const txnId = uuidv4();
  const jti = uuidv4();
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);

  // Only one live transaction per partner, so a stale QR cannot be redeemed.
  await AadhaarVerification.updateMany(
    { partner: partner._id, status: 'pending' },
    { $set: { status: 'expired' } }
  );

  await AadhaarVerification.create({
    partner: partner._id,
    user: user._id,
    entityType: partner.partnerType === 'freelancer' ? 'freelancer' : 'talent_partner',
    txnId,
    jti,
    channel,
    status: 'pending',
    requestedAt: new Date(),
    expiresAt,
    initiatedIp: ip
  });

  const hint = [partner.firstName, partner.lastName].filter(Boolean).join(' ') || null;
  const requestJwt = signIntentRequest({ channel, txnId, jti, hint });

  return {
    txnId,
    channel,
    expiresAt,
    intentUrl: channel === 'web' ? buildWebIntentUrl(requestJwt) : null,
    qrValue: channel === 'qr' ? buildCrossDeviceQrValue(requestJwt) : null
  };
}

// ============================================================================
// §3.3 / §3.4 - receive and verify the SD-JWT
// ============================================================================

/**
 * §3.3 Callback format:
 *   <Request><TxnID>TXN_ID</TxnID><Credential>SD-JWT</Credential></Request>
 *
 * Parsed with targeted extraction rather than a full XML parser: the envelope
 * is a fixed two-field shape, and avoiding a parser keeps untrusted XML away
 * from entity-expansion handling entirely.
 */
function parseCallbackXml(raw) {
  if (!raw || typeof raw !== 'string') return {};
  const txn = raw.match(/<TxnID>\s*([\s\S]*?)\s*<\/TxnID>/i);
  const credential = raw.match(/<Credential>\s*([\s\S]*?)\s*<\/Credential>/i);
  const errCode = raw.match(/<(?:ResponseCode|ErrorCode)>\s*([\s\S]*?)\s*<\/(?:ResponseCode|ErrorCode)>/i);
  const errMsg = raw.match(/<(?:ResponseMsg|ErrorMessage)>\s*([\s\S]*?)\s*<\/(?:ResponseMsg|ErrorMessage)>/i);

  return {
    txnId: txn ? txn[1].trim() : null,
    credential: credential ? credential[1].trim() : null,
    errorCode: errCode ? errCode[1].trim() : null,
    errorMessage: errMsg ? errMsg[1].trim() : null
  };
}

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
}

function sha256Base64Url(value) {
  return crypto
    .createHash('sha256')
    .update(value, 'ascii')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * §3.4 Verify SD-JWT. Format (§3.3): a.b.c~d1~d2
 *
 * §3.4.1 Signature: split header.payload.signature, retrieve the UIDAI public
 *        key, verify the RS256 signature, reject if invalid.
 * §3.4.2 Disclosure: hash each disclosure string with SHA256, base64url-encode,
 *        match against the _sd array, reject on mismatch.
 * Both validations are mandatory.
 *
 * @param {string} sdJwt
 * @returns {{claims: object, payload: object}}
 */
function verifySdJwt(sdJwt) {
  if (!sdJwt || typeof sdJwt !== 'string') {
    throw new Error('Empty credential');
  }

  const parts = sdJwt.trim().split('~');
  const issuerJwt = parts.shift();

  // A trailing key-binding JWT (if ever present) is not a disclosure.
  if (parts.length && parts[parts.length - 1].includes('.')) parts.pop();
  const disclosures = parts.filter(Boolean);

  // §3.4.1
  const payload = jwt.verify(issuerJwt, getUidaiPublicKey(), {
    algorithms: ['RS256'],
    ignoreExpiration: false
  });

  // §3.4.2
  const sdHashes = new Set(Array.isArray(payload._sd) ? payload._sd : []);
  const claims = {};

  for (const disclosure of disclosures) {
    if (!sdHashes.has(sha256Base64Url(disclosure))) {
      throw new Error('Disclosure hash not found in signed credential');
    }

    let decoded;
    try {
      decoded = JSON.parse(base64UrlDecode(disclosure).toString('utf8'));
    } catch {
      throw new Error('Malformed disclosure payload');
    }
    if (!Array.isArray(decoded) || decoded.length < 3) {
      throw new Error('Malformed disclosure structure');
    }

    // SD-JWT disclosure array is [salt, claimName, claimValue].
    const [, claimName, claimValue] = decoded;
    claims[claimName] = claimValue;
  }

  // Claims published directly in the payload (not selectively disclosed).
  for (const [k, v] of Object.entries(payload)) {
    if (k === '_sd' || k === '_sd_alg') continue;
    if (!(k in claims)) claims[k] = v;
  }

  return { claims, payload };
}

function pickClaim(claims, ...names) {
  for (const n of names) {
    const v = claims[n];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * Handle the UIDAI callback: verify the credential, persist the KYC data, and
 * flip the transaction to `verified`.
 *
 * @param {string}  sdJwt        raw credential (never persisted)
 * @param {string} [txnIdHint]   TxnID from the XML envelope
 * @param {string} [callbackIp]
 */
async function verifyCallback(sdJwt, txnIdHint, callbackIp) {
  const { claims } = verifySdJwt(sdJwt);

  // Bind the credential to a transaction WE issued (§3.7 "Validate txn and jti").
  const txnId = pickClaim(claims, 'txn', 'txnId', 'transactionId') || txnIdHint;
  if (!txnId) throw new Error('Credential carries no transaction id');

  const record = await AadhaarVerification.findOne({ txnId });
  if (!record) throw new Error('Unknown transaction');

  // §3.7 "Reject replayed transactions".
  if (record.status === 'verified') {
    return { txnId, status: 'verified', alreadyVerified: true };
  }
  if (record.status === 'expired') throw new Error('Transaction expired');
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
    record.status = 'expired';
    await record.save();
    throw new Error('Transaction expired');
  }

  // Claim names follow §3.1.4's bitmap mapping (camelCase).
  const fullName = pickClaim(claims, 'residentName', 'name', 'fullName');
  const dob = pickClaim(claims, 'dob', 'dateOfBirth');
  const gender = normalizeGender(pickClaim(claims, 'gender'));
  const photoRaw = pickClaim(claims, 'residentImage', 'photo', 'image');
  const addressRaw = pickClaim(claims, 'address', 'addr');
  const pincode = pickClaim(claims, 'pincode', 'pc');

  const address = normalizeAddress(
    typeof addressRaw === 'object'
      ? { ...addressRaw, pc: addressRaw?.pc || pincode }
      : { full: addressRaw, pc: pincode }
  );

  // §3.1.4 has no UID claim, so this is normally null. Kept defensively: if a
  // future bitmap revision returns one, it is masked before it ever hits disk.
  const maskedAadhaar =
    maskAadhaar(pickClaim(claims, 'maskedUID', 'maskedAadhaar', 'uid')) || null;

  // Audit copy without the photo (large) or anything carrying a full number.
  const rawClaims = { ...claims };
  delete rawClaims.residentImage;
  delete rawClaims.photo;
  delete rawClaims.image;
  delete rawClaims.uid;
  delete rawClaims.enrolmentNumber;

  record.status = 'verified';
  record.fullName = fullName;
  record.dob = dob;
  record.gender = gender;
  record.address = address;
  record.photoUrl = formatPhotoUrl(photoRaw);
  record.maskedAadhaar = maskedAadhaar;
  record.rawClaims = rawClaims;
  record.verifiedAt = new Date();
  record.callbackIp = callbackIp;
  record.expiresAt = undefined; // retain verified rows for audit
  await record.save();

  const partner = await StaffingPartner.findById(record.partner);
  if (partner) {
    const profileName = [partner.firstName, partner.lastName].filter(Boolean).join(' ');
    partner.aadhaarVerification = {
      verified: true,
      verifiedAt: record.verifiedAt,
      maskedAadhaar: record.maskedAadhaar,
      fullName: record.fullName,
      dob: record.dob,
      gender: record.gender,
      photoUrl: record.photoUrl,
      address: record.address,
      txnId: record.txnId,
      aadhaarDocId: record._id,
      provider: 'uidai-pehchaan',
      nameMatch: namesLooselyMatch(record.fullName, profileName)
    };
    await partner.save();
  }

  return { txnId, status: 'verified' };
}

/**
 * Record a failed attempt (§3.6 error codes 301-308) so the browser poll can
 * surface a reason instead of spinning until timeout.
 */
async function recordFailure(txnId, code, reason) {
  if (!txnId) return;
  await AadhaarVerification.updateOne(
    { txnId, status: 'pending' },
    {
      $set: {
        status: 'failed',
        failureCode: code ? String(code) : undefined,
        failureReason: reason
      }
    }
  );
}

// ============================================================================
// Polling
// ============================================================================

async function getStatus(txnId, userId) {
  const record = await AadhaarVerification.findOne({ txnId });
  if (!record) return { status: 'unknown' };

  if (userId && record.user && String(record.user) !== String(userId)) {
    return { status: 'unknown' };
  }

  if (
    record.status === 'pending' &&
    record.expiresAt &&
    record.expiresAt.getTime() < Date.now()
  ) {
    record.status = 'expired';
    await record.save();
  }

  if (record.status !== 'verified') {
    return {
      status: record.status,
      failureCode: record.failureCode,
      failureReason: record.failureReason
    };
  }

  return {
    status: 'verified',
    verifiedAt: record.verifiedAt,
    kyc: {
      fullName: record.fullName,
      maskedAadhaar: record.maskedAadhaar,
      dob: record.dob,
      gender: record.gender,
      photoUrl: record.photoUrl,
      address: record.address
    }
  };
}

module.exports = {
  isConfigured,
  buildBitmap,
  BITMAP_CLAIMS,
  REQUESTED_CLAIMS,
  SC_BITMAP,
  signIntentRequest,
  buildWebIntentUrl,
  buildCrossDeviceQrValue,
  buildRequestJwt,
  parseCallbackXml,
  verifySdJwt,
  verifyCallback,
  recordFailure,
  getStatus,
  TTL_SECONDS
};
