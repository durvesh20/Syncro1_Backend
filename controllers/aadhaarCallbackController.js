// backend/controllers/aadhaarCallbackController.js
//
// UIDAI-facing callback for the Aadhaar App Intent Integration (Spec v2 §3.3,
// §3.5). PUBLIC by design: the Aadhaar App POSTs here directly and carries no
// session. Authenticity comes from the RS256 SD-JWT signature verified against
// the UIDAI public key, plus the credential's binding to a txn we issued.
//
// §3.7: never log the credential.

const pehchaanService = require('../services/pehchaanService');

/**
 * §3.5 Send Acknowledgement.
 *
 * Success:
 *   <Response><TxnID>..</TxnID><ResponseCode>200</ResponseCode>
 *   <ResponseMsg>Success</ResponseMsg></Response>
 *
 * Failure: same shape with the error code and message.
 */
function acknowledgement({ txnId, code, message }) {
  const esc = (v) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  return (
    '<Response>\n' +
    `  <TxnID>${esc(txnId)}</TxnID>\n` +
    `  <ResponseCode>${esc(code)}</ResponseCode>\n` +
    `  <ResponseMsg>${esc(message)}</ResponseMsg>\n` +
    '</Response>'
  );
}

function sendAck(res, httpStatus, body) {
  res.status(httpStatus).type('application/xml').send(acknowledgement(body));
}

/**
 * POST /api/aadhaar/callback
 *
 * Body (§3.3):
 *   <Request><TxnID>TXN_ID</TxnID><Credential>SD-JWT</Credential></Request>
 *
 * The credential itself is `a.b.c~d1~d2`.
 */
exports.handleCallback = async (req, res) => {
  // Fallback hint if the envelope is unreadable, so the ack can still name a txn.
  let txnId = req.query.txn || req.query.txnId || null;

  try {
    const raw =
      typeof req.body === 'string'
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body.toString('utf8')
          : '';

    const parsed = pehchaanService.parseCallbackXml(raw);
    txnId = parsed.txnId || txnId;

    // The app reports a failure (§3.6 codes 301-308) instead of a credential.
    if (!parsed.credential && parsed.errorCode) {
      await pehchaanService.recordFailure(txnId, parsed.errorCode, parsed.errorMessage);
      console.log(`[pehchaan] callback error txn=${txnId} code=${parsed.errorCode}`);
      return sendAck(res, 200, {
        txnId,
        code: parsed.errorCode,
        message: parsed.errorMessage || 'Failure acknowledged'
      });
    }

    if (!parsed.credential) {
      return sendAck(res, 400, {
        txnId,
        code: '400',
        message: 'No credential supplied'
      });
    }

    const result = await pehchaanService.verifyCallback(parsed.credential, txnId, req.ip);

    // §3.7: transaction id and timestamp only.
    console.log(`[pehchaan] callback verified txn=${result.txnId} at=${new Date().toISOString()}`);

    return sendAck(res, 200, {
      txnId: result.txnId,
      code: '200',
      message: 'Success'
    });
  } catch (error) {
    // error.message is ours, never credential content, so it is safe to log.
    console.error(`[pehchaan] callback rejected txn=${txnId}: ${error.message}`);

    // 200 with a failure ack: the credential was bad and retrying will not
    // help. A 5xx would trigger the app's callback-retry path (error 308).
    return sendAck(res, 200, {
      txnId,
      code: '400',
      message: 'Verification failed'
    });
  }
};

/**
 * GET /api/aadhaar/callback
 * Reachability check — the callback URL registered with UIDAI must resolve.
 */
exports.healthCheck = async (req, res) => {
  return sendAck(res, 200, {
    txnId: '',
    code: '200',
    message: 'Aadhaar callback endpoint is live'
  });
};
