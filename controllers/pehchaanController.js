// backend/controllers/pehchaanController.js
//
// Resident-facing endpoints for Aadhaar App Intent verification (Spec v2).
// The UIDAI-facing callback lives in aadhaarCallbackController.js.

const QRCode = require('qrcode');
const pehchaanService = require('../services/pehchaanService');
const StaffingPartner = require('../models/StaffingPartner');

// Off unless explicitly enabled. While UIDAI registers our Intent Request
// signing key the Aadhaar App rejects every request we generate with
// "Invalid JWT", so the flow is hidden in the UI and refused here too.
const AADHAAR_VERIFICATION_ENABLED =
  String(process.env.AADHAAR_VERIFICATION_ENABLED).toLowerCase() === 'true';

/**
 * POST /api/pehchaan/init
 * Body: { channel: 'web' | 'qr' }
 *
 * `channel` must match how the Aadhaar App will actually be launched, because
 * it is signed into the request as the `ch` claim (§3.1.3):
 *   - 'web' : Android browser -> Web-to-App intent URL (§3.2.2)
 *   - 'qr'  : desktop/iOS     -> Cross-Device QR (§3.2.3)
 */
exports.initPehchaan = async (req, res) => {
  try {
    if (!AADHAAR_VERIFICATION_ENABLED) {
      return res.status(503).json({
        success: false,
        code: 'AADHAAR_VERIFICATION_DISABLED',
        message: 'Aadhaar verification is temporarily unavailable.'
      });
    }

    // A sub-admin must not run identity verification on the org's behalf -
    // this proves the identity of one specific person.
    if (req.user.createdBy) {
      return res.status(403).json({
        success: false,
        message: 'Aadhaar verification must be completed by the account owner.'
      });
    }

    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    // middleware/auth.js `authorize` treats freelancer/talent/talent_partner as
    // interchangeable, so gate on partnerType explicitly: this step is part of
    // the freelancer onboarding flow only.
    if (partner.partnerType !== 'freelancer') {
      return res.status(403).json({
        success: false,
        message: 'Aadhaar verification is only required for freelancer accounts.'
      });
    }

    if (partner.aadhaarVerification?.verified) {
      return res.json({
        success: true,
        data: {
          alreadyVerified: true,
          kyc: {
            fullName: partner.aadhaarVerification.fullName,
            maskedAadhaar: partner.aadhaarVerification.maskedAadhaar,
            dob: partner.aadhaarVerification.dob,
            gender: partner.aadhaarVerification.gender,
            photoUrl: partner.aadhaarVerification.photoUrl,
            address: partner.aadhaarVerification.address
          }
        }
      });
    }

    const channel = req.body?.channel === 'qr' ? 'qr' : 'web';

    const { txnId, intentUrl, qrValue, expiresAt } = await pehchaanService.buildRequestJwt({
      partner,
      user: req.user,
      channel,
      ip: req.ip
    });

    // Render the §3.2.3 QR payload server-side so the browser needs no QR
    // library. The payload already carries the signed request, so there is no
    // separate resume endpoint to secure.
    let qrDataUrl = null;
    if (channel === 'qr' && qrValue) {
      try {
        qrDataUrl = await QRCode.toDataURL(qrValue, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 300
        });
      } catch (qrError) {
        console.error('[pehchaan] QR generation failed:', qrError.message);
      }
    }

    // §3.7: transaction id and timestamp only - never the JWT or KYC data.
    console.log(
      `[pehchaan] init txn=${txnId} ch=${channel} partner=${partner._id} at=${new Date().toISOString()}`
    );

    return res.json({
      success: true,
      data: {
        txnId,
        channel,
        intentUrl,   // 'web' only
        qrDataUrl,   // 'qr' only
        expiresAt,
        ttlSeconds: pehchaanService.TTL_SECONDS
      }
    });
  } catch (error) {
    if (error.code === 'PEHCHAAN_NOT_CONFIGURED') {
      return res.status(503).json({
        success: false,
        code: 'PEHCHAAN_NOT_CONFIGURED',
        message: 'Aadhaar verification is temporarily unavailable. Please contact support.'
      });
    }
    console.error('[pehchaan] init failed:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Could not start Aadhaar verification. Please try again.'
    });
  }
};

/**
 * GET /api/pehchaan/status/:txnId
 * Polled by the browser until the resident finishes in the Aadhaar App.
 */
exports.getStatus = async (req, res) => {
  try {
    const result = await pehchaanService.getStatus(req.params.txnId, req.user._id);

    if (result.status === 'unknown') {
      return res.status(404).json({ success: false, message: 'Unknown transaction' });
    }

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[pehchaan] status failed:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Could not read verification status.'
    });
  }
};

/**
 * GET /api/pehchaan/config
 * Whether live verification is configured, so the UI can explain itself rather
 * than failing at the point of use.
 */
exports.getConfig = async (req, res) => {
  return res.json({
    success: true,
    data: { configured: pehchaanService.isConfigured() }
  });
};
