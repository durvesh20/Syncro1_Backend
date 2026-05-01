const cookieParser = require('cookie-parser');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

// Load env vars
dotenv.config();

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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
  'http://localhost:3000'
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


// ✅ WhatsApp template consent redirect routes
// Template buttons go to: https://syncro1.com/consent/candidate/agree/:token
// These redirect to our API

app.get('/consent/candidate/agree/:token', (req, res) => {
  res.redirect(
    `/api/candidates/consent/agree/${req.params.token}`
  );
});

app.get('/consent/candidate/disagree/:token', (req, res) => {
  res.redirect(
    `/api/candidates/consent/disagree/${req.params.token}`
  );
});


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

// ✅ These 3 were missing — now added ONCE
app.use('/api/job-interests', require('./routes/jobInterestRoutes'));
app.use('/api/agreements', require('./routes/agreementRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  console.error('Error:', err);

  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: messages
    });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({
      success: false,
      message: `${field} already exists`
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired' });
  }

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

/* =========================================================
   SERVE FRONTEND BUILD
========================================================= */

app.use(express.static(path.join(__dirname, '../Syncro1_Frontend/build')));

app.get('*', (req, res) => {
  res.sendFile(
    path.resolve(__dirname, '../Syncro1_Frontend/build', 'index.html')
  );
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
    (process.env.AI_ENABLED === 'true' && process.env.GEMINI_API_KEY
      ? '🤖 Enabled (' + (process.env.GEMINI_MODEL || 'gemini-1.5-flash') + ')'
      : '⏸️  Disabled')
  );
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
});

/* =========================================================
   PROCESS ERROR HANDLING
========================================================= */

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err.message);
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  process.exit(1);
});

module.exports = app;