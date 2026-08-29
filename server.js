const cookieParser = require('cookie-parser');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const connectDB = require('./config/db');
const sanitizeErrors = require('./middleware/sanitizeErrors');
require('./config/env');


// Connect to database
connectDB();

// Test Cloudinary connection
const { testConnection: testCloudinary } = require('./config/cloudinary');
testCloudinary();

// Initialize AI
const { initializeAI } = require('./config/ai');
initializeAI();


// ✅ Register ALL models BEFORE routes (prevents MissingSchemaError)
require('./models/Notification');
require('./models/AgreementQuery');
require('./models/AdminActionLog');
require('./models/JobInterest');
require('./models/LimitExtensionRequest');
require('./models/Payout');
require('./models/Invoice');
require('./models/ScoringLog');
require('./models/Testimonial');
require('./models/Award');
require('./models/CompanyLogo');
require('./models/LandingPageLead');

const app = express();

/* =========================================================
   SECURITY MIDDLEWARE
========================================================= */

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

/* =========================================================
   RATE LIMITING
========================================================= */

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again after 15 minutes'
  }
});

const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== 'false';

if (rateLimitEnabled) {
  app.use('/api', limiter);
  app.use('/api/auth', authLimiter);
  console.log('✅ Rate limiting enabled');
} else {
  console.log('⏸️ Rate limiting disabled');
}

/* =========================================================
   BODY PARSING
========================================================= */

const mongoSanitize = require('express-mongo-sanitize');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* =========================================================
   NOSQL INJECTION SANITIZATION
   Sanitize user-supplied data to prevent NoSQL query injection (strips $ and .)
========================================================= */
app.use(mongoSanitize({
  replaceWith: '_'
}));

/* =========================================================
   COOKIE PARSER
========================================================= */

app.use(cookieParser());

/* =========================================================
   CORS CONFIGURATION
========================================================= */

const allowedOrigins = [
  'https://syncro1.com',
  'https://www.syncro1.com',
  'http://localhost:9696',
  'http://localhost:3000',
  'http://localhost:2121',
  'https://syncro1.co',
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow Postman / server-to-server / requests without browser origin
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Set-Cookie']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* =========================================================
   STATIC FILES
========================================================= */

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }
}));

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

/* =========================================================
   ERROR SANITIZATION
   Intercepts all res.json() calls — strips raw `error` field
   in production to prevent internal detail leakage.
   Must be mounted AFTER health check, BEFORE all API routes.
========================================================= */

app.use(sanitizeErrors);

/* =========================================================
   API ROUTES — MOUNTED ONCE ONLY
========================================================= */

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/staffing-partners', require('./routes/staffingPartnerRoutes'));
app.use('/api/companies', require('./routes/companyRoutes'));
app.use('/api/jobs', require('./routes/jobRoutes'));
app.use('/api/candidates', require('./routes/candidateRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/admin/sub-admins', require('./routes/adminSubAdminRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/onboarding', require('./routes/onboardingRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/invoices', require('./routes/invoiceRoutes'));
app.use('/api/cities', require('./routes/citySuggestionRoutes'));
app.use('/api/job-interests', require('./routes/jobInterestRoutes'));
app.use('/api/agreements', require('./routes/agreementRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/landing', require('./routes/landingRoutes'));
app.use('/api/landingpage', require('./routes/landingpageRoutes'));


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  // Always log the full error server-side (PM2 logs) — never trust the client with internals
  console.error(`[GLOBAL ERROR] ${req.method} ${req.originalUrl}:`, err);

  const IS_PRODUCTION = process.env.NODE_ENV === 'production';

  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: IS_PRODUCTION
        ? ['Invalid input data']   // hide field names / schema paths in production
        : messages
    });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({
      success: false,
      message: IS_PRODUCTION ? 'A duplicate entry was detected' : `${field} already exists`
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired' });
  }

  // Generic fallback — never leak err.message or stack in production
  res.status(err.statusCode || 500).json({
    success: false,
    message: IS_PRODUCTION ? 'Internal Server Error' : (err.message || 'Internal Server Error'),
    ...(IS_PRODUCTION ? {} : { stack: err.stack })
  });
});


/* =========================================================
   START SERVER
========================================================= */

const cloudinaryConfigured =
  !!process.env.CLOUDINARY_CLOUD_NAME &&
  !!process.env.CLOUDINARY_API_KEY &&
  !!process.env.CLOUDINARY_API_SECRET;

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log('');
  console.log('🚀 ═══════════════════════════════════════════════════');
  console.log(`   Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  console.log('   ───────────────────────────────────────────────────');
  console.log(`   📡 API:      http://localhost:${PORT}/api`);
  console.log(`   💚 Health:   http://localhost:${PORT}/api/health`);
  console.log('   ───────────────────────────────────────────────────');
  console.log(
    '   WhatsApp:   ' +
    (process.env.WHATSAPP_ENABLED === 'true'
      ? '✅ Enabled'
      : '⏸️  Disabled (Mock)')
  );
  console.log(
    '   Payments:   ' +
    (process.env.PAYMENT_ENABLED === 'true'
      ? '✅ Enabled'
      : '⏸️  Disabled (Mock)')
  );
  console.log(
    '   Cloudinary: ' +
    (cloudinaryConfigured ? '☁️  Configured' : '⚠️  Not configured')
  );
  console.log(
    '   AI:         ' +
    (process.env.AI_ENABLED === 'true' && process.env.OPENAI_API_KEY
      ? '🤖 Enabled (OpenAI ' + (process.env.OPENAI_MODEL || 'gpt-5-mini') + ')'
      : '⏸️  Disabled')
  );
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
});

/* =========================================================
   PROCESS ERROR HANDLING
========================================================= */

process.on('unhandledRejection', (err, promise) => {
  // Log full info regardless of whether err is an Error or a plain object/string
  const msg = err instanceof Error
    ? `${err.message}\n${err.stack}`
    : JSON.stringify(err, null, 2);
  console.error('[WARN] Unhandled Promise Rejection — server kept alive.');
  console.error('[WARN] Rejection value:', msg);
  // Do NOT kill the server — just log and continue
  // Remove server.close()+process.exit() so one bad promise doesn't cause all
  // subsequent requests to time out.
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  process.exit(1);
});

module.exports = app;