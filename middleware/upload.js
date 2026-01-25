// backend/middleware/upload.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Ensure upload directories exist
const uploadDirs = [
  'uploads',
  'uploads/resumes',
  'uploads/documents',
  'uploads/logos',
  'uploads/others'
];

uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure storage
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    let uploadPath = 'uploads/';
    
    switch(file.fieldname) {
      case 'resume':
        uploadPath += 'resumes/';
        break;
      case 'logo':
        uploadPath += 'logos/';
        break;
      case 'panCard':
      case 'gstCertificate':
      case 'registrationCertificate':
      case 'addressProof':
      case 'cancelledCheque':
      case 'incorporationCertificate':
      case 'authorizedSignatoryProof':
        uploadPath += 'documents/';
        break;
      default:
        uploadPath += 'others/';
    }
    
    cb(null, uploadPath);
  },
  filename: function(req, file, cb) {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  // Define allowed types per field
  const allowedTypes = {
    resume: {
      mimes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      extensions: ['.pdf', '.doc', '.docx']
    },
    logo: {
      mimes: ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'],
      extensions: ['.jpg', '.jpeg', '.png', '.svg', '.webp']
    },
    document: {
      mimes: ['application/pdf', 'image/jpeg', 'image/png'],
      extensions: ['.pdf', '.jpg', '.jpeg', '.png']
    }
  };

  const fieldName = file.fieldname;
  let typeConfig;

  if (fieldName === 'resume') {
    typeConfig = allowedTypes.resume;
  } else if (fieldName === 'logo') {
    typeConfig = allowedTypes.logo;
  } else {
    typeConfig = allowedTypes.document;
  }

  const ext = path.extname(file.originalname).toLowerCase();
  
  if (typeConfig.mimes.includes(file.mimetype) || typeConfig.extensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type for ${fieldName}. Allowed: ${typeConfig.extensions.join(', ')}`), false);
  }
};

// Create multer instance
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max
  }
});

// Export different upload configurations
module.exports = {
  // Single file uploads
  uploadResume: upload.single('resume'),
  uploadLogo: upload.single('logo'),
  uploadDocument: upload.single('document'),

  // Multiple document uploads for KYC
  uploadPartnerDocuments: upload.fields([
    { name: 'panCard', maxCount: 1 },
    { name: 'gstCertificate', maxCount: 1 },
    { name: 'registrationCertificate', maxCount: 1 },
    { name: 'addressProof', maxCount: 1 },
    { name: 'cancelledCheque', maxCount: 1 }
  ]),

  uploadCompanyDocuments: upload.fields([
    { name: 'incorporationCertificate', maxCount: 1 },
    { name: 'gstCertificate', maxCount: 1 },
    { name: 'panCard', maxCount: 1 },
    { name: 'addressProof', maxCount: 1 },
    { name: 'authorizedSignatoryProof', maxCount: 1 }
  ]),

  // Generic upload for any file
  uploadAny: upload.any(),

  // Error handler middleware
  handleUploadError: (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum size is 10MB'
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
    next();
  }
};