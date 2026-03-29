module.exports = function sendTokenResponse(res, token, user, extra = {}) {
  const isProd = process.env.NODE_ENV === 'production';
  const isSecure = process.env.COOKIE_SECURE === 'true';

  res.cookie('token', token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });

  // ✅ FIXED: Token now properly nested inside data object
  return res.json({
    success: true,
    data: {
      token,      
      user,
      ...extra
    }
  });
};

