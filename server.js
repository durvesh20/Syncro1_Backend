
const cookieParser = require('cookie-parser');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const onboardingRoutes = require('./routes/onboardingRoutes');

// Load env vars
dotenv.config();

// Connect to database
connectDB();

// Test Cloudinary connection
const { testConnection: testCloudinary } = require('./config/cloudinary');
testCloudinary();


// Initialize AI
// Initialize AI
const { initializeAI } = require('./config/ai');
initializeAI();

// ✅ Register Notification model BEFORE routes
require('./models/Notification');

// ✅ Register AgreementQuery model  
require('./models/AgreementQuery');

// ===================== PART 10 FIX =====================
// Register new models
require('./models/AdminActionLog');
require('./models/JobInterest');
require('./models/LimitExtensionRequest');

// =======================================================

// (IMPORTANT: app must exist before using app.use)
const app = express();

// Mount new routes
app.use('/api/job-interests', require('./routes/jobInterestRoutes'));
app.use('/api/agreements', require('./routes/agreementRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));

/* =========================================================
   SECURITY MIDDLEWARE
========================================================= */

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// =========================================================
// RATE LIMITING
// =========================================================

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again after 15 minutes',
  },
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
   COOKIE PARSER (MUST BE BEFORE CORS)
========================================================= */

app.use(cookieParser());

/* =========================================================
   CORS CONFIGURATION - UPDATED
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
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Set-Cookie']
};

app.use(cors(corsOptions));

// Respond quickly to preflight
app.options('*', cors(corsOptions));

/* =========================================================
   STATIC UPLOADS
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
    environment: process.env.NODE_ENV,
  });
});

/* =========================================================
   API ROUTES
========================================================= */

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/staffing-partners', require('./routes/staffingPartnerRoutes'));
app.use('/api/companies', require('./routes/companyRoutes'));
app.use('/api/jobs', require('./routes/jobRoutes'));
app.use('/api/candidates', require('./routes/candidateRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/admin/sub-admins', require('./routes/adminSubAdminRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
// Register routes
app.use('/api/onboarding', onboardingRoutes);

// ✅ Newly added routes
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/invoices', require('./routes/invoiceRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));

app.use('/api/agreements', require('./routes/agreementRoutes'));



/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  console.error('Error:', err);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: messages,
    });
  }

  // Duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({
      success: false,
      message: `${field} already exists`,
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired',
    });
  }

  // Default error
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
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
    (cloudinaryConfigured
      ? '☁️ Configured'
      : '⚠️ Not configured (check .env)')
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

const cloudinaryConfigured =
  !!process.env.CLOUDINARY_CLOUD_NAME &&
  !!process.env.CLOUDINARY_API_KEY &&
  !!process.env.CLOUDINARY_API_SECRET;

/* ==================================== =====================
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