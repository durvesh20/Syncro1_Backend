// backend/utils/sendTokenResponse.js
module.exports = function sendTokenResponse(res, token, user, extra = {}) {
  const isProd = process.env.NODE_ENV === 'production';

  res.cookie('token', token, {
    httpOnly: true,
    secure: isProd,               // true in production (HTTPS)
    sameSite: isProd ? 'none' : 'lax', // if FE+BE on different domains in prod => 'none'
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  return res.json({
    success: true,
    data: {
      user,
      ...extra
    }
  });
};