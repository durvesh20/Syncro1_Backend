// backend/services/otpService.js
const crypto = require('crypto');

class OTPService {
  generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
  }

  generateSecureOTP(length = 6) {
    const buffer = crypto.randomBytes(length);
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += buffer[i] % 10;
    }
    return otp;
  }

  getExpiryTime(minutes = 10) {
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  isExpired(expiryTime) {
    return new Date() > new Date(expiryTime);
  }

  hashOTP(otp) {
    return crypto.createHash('sha256').update(otp).digest('hex');
  }

  verifyHashedOTP(otp, hashedOTP) {
    return this.hashOTP(otp) === hashedOTP;
  }
}

module.exports = new OTPService();