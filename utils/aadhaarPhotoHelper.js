// backend/utils/aadhaarPhotoHelper.js
//
// Small formatting helpers for Aadhaar KYC payloads. Kept separate from
// pehchaanService so they can be unit tested without any crypto/env setup.

// Neutral avatar used when UIDAI returns no photo (or returns an unusable one).
// Inlined as a data URI so it needs no static asset or network fetch.
const SAMPLE_AADHAAR_PHOTO =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="200" viewBox="0 0 160 200">
      <rect width="160" height="200" fill="#E9EEF6"/>
      <circle cx="80" cy="74" r="32" fill="#B9C7DC"/>
      <path d="M24 186c0-31 25-56 56-56s56 25 56 56z" fill="#B9C7DC"/>
    </svg>`
  ).toString('base64');

/**
 * Normalise whatever UIDAI returns for the resident photo into something an
 * <img src> can render.
 *
 * Accepts: a full data URI, a bare base64 JPEG/PNG blob, or an http(s) URL.
 * Anything else (empty, malformed, non-string) falls back to the placeholder.
 *
 * @param {string} raw
 * @returns {string} a renderable image src
 */
function formatPhotoUrl(raw) {
  if (!raw || typeof raw !== 'string') return SAMPLE_AADHAAR_PHOTO;

  const value = raw.trim();
  if (!value) return SAMPLE_AADHAAR_PHOTO;

  // Already a data URI.
  if (value.startsWith('data:image/')) return value;

  // Remote URL - only allow https to avoid mixed-content in the browser.
  if (/^https:\/\//i.test(value)) return value;
  if (/^http:\/\//i.test(value)) return SAMPLE_AADHAAR_PHOTO;

  // Bare base64. Validate before trusting it so we never emit a broken src.
  const compact = value.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length < 64) {
    return SAMPLE_AADHAAR_PHOTO;
  }

  // Sniff the container from the base64 prefix: /9j/ => JPEG, iVBOR => PNG.
  const mime = compact.startsWith('/9j/')
    ? 'image/jpeg'
    : compact.startsWith('iVBOR')
      ? 'image/png'
      : 'image/jpeg';

  return `data:${mime};base64,${compact}`;
}

/**
 * UIDAI returns gender as a single character. Map it to the values our schema
 * accepts; anything unrecognised becomes 'Other' rather than throwing.
 *
 * @param {string} g
 * @returns {'Male'|'Female'|'Other'}
 */
function normalizeGender(g) {
  if (!g || typeof g !== 'string') return 'Other';
  const key = g.trim().toUpperCase();
  if (key === 'M' || key === 'MALE') return 'Male';
  if (key === 'F' || key === 'FEMALE') return 'Female';
  return 'Other';
}

/**
 * Mask an Aadhaar number for storage/display: "XXXX XXXX 1234".
 * Returns null if fewer than 4 digits are present, so callers never persist a
 * half-formed value that could be mistaken for a real one.
 *
 * @param {string} aadhaarNumber
 * @returns {string|null}
 */
function maskAadhaar(aadhaarNumber) {
  if (!aadhaarNumber) return null;
  const digits = String(aadhaarNumber).replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `XXXX XXXX ${digits.slice(-4)}`;
}

/**
 * Flatten the UIDAI address object into our schema shape plus a single
 * human-readable line. UIDAI field names vary across versions, so each slot
 * accepts a few aliases.
 *
 * @param {object} addr
 * @returns {object}
 */
function normalizeAddress(addr) {
  if (!addr || typeof addr !== 'object') return {};

  const pick = (...keys) => {
    for (const k of keys) {
      const v = addr[k];
      if (v && typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
  };

  const line1 = pick('house', 'line1', 'careof', 'co');
  const line2 = pick('street', 'line2', 'landmark', 'loc', 'locality');
  const city = pick('vtc', 'city', 'town', 'village');
  const district = pick('dist', 'district', 'subdist');
  const state = pick('state');
  const pincode = pick('pc', 'pincode', 'zip');

  const full =
    pick('full', 'address') ||
    [line1, line2, city, district, state, pincode].filter(Boolean).join(', ') ||
    undefined;

  return { line1, line2, city, district, state, pincode, full };
}

/**
 * Loose comparison of the Aadhaar name against the name on the profile.
 * Case/punctuation/order insensitive - initials and middle names differ often
 * enough that an exact match would false-flag most real users. Used only to set
 * an advisory `nameMatch` flag for admin review, never to block verification.
 *
 * @param {string} aadhaarName
 * @param {string} profileName
 * @returns {boolean|null} null when either side is missing
 */
function namesLooselyMatch(aadhaarName, profileName) {
  if (!aadhaarName || !profileName) return null;

  const tokens = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);

  const a = tokens(aadhaarName);
  const b = tokens(profileName);
  if (!a.length || !b.length) return null;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const longerSet = new Set(longer);
  const overlap = shorter.filter((t) => longerSet.has(t)).length;

  // Every token of the shorter name should appear in the longer one.
  return overlap === shorter.length;
}

module.exports = {
  SAMPLE_AADHAAR_PHOTO,
  formatPhotoUrl,
  normalizeGender,
  maskAadhaar,
  normalizeAddress,
  namesLooselyMatch
};
