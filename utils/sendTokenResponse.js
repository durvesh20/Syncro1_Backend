// backend/utils/sendTokenResponse.js
module.exports = function sendTokenResponse(res, token, user, extra = {}) {
  const isProd = process.env.NODE_ENV === 'production';
  const isSecure = process.env.COOKIE_SECURE === 'true'; // Add this env var

  res.cookie('token', token, {
    httpOnly: true,
    secure: isSecure,  // Explicitly control via env
    sameSite: isSecure ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/' // Ensure cookie is sent for all routes
  });

  return res.json({
    success: true,
    token, 
    data: { user, ...extra }
  });
};
