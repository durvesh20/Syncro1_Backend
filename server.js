
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

// ✅ Register Notification model BEFORE routes
require('./models/Notification');

const app = express();

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
   CORS CONFIGURATION - ✅ FIXED
========================================================= */

// ✅ IMPORTANT: CORS must come AFTER cookieParser but BEFORE routes
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true, // ✅ Essential for cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Set-Cookie'],
}));

// Respond quickly to preflight
app.options('*', cors());

/* =========================================================
   STATIC UPLOADS
========================================================= */

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
app.use('/api/payments', require('./routes/paymentRoutes'));

// ✅ Newly added routes
app.use('/api/notifications', require('./routes/notificationRoutes'));
// app.use('/api/invoices', require('./routes/invoiceRoutes')); // DISABLED - Payout system inactive

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