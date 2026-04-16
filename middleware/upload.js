// backend/middleware/upload.js
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { cloudinary } = require('../config/cloudinary');
const path = require('path');

// ==================== CLOUDINARY STORAGE CONFIGS ====================

// Resume storage
const resumeStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'syncro1/resumes',
    resource_type: 'raw',
    allowed_formats: ['pdf', 'doc', 'docx'],
    transformation: [],
    public_id: (req, file) => {
      const uniqueName = `resume_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
      return uniqueName;
    }
  }
});

// Logo storage
const logoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'syncro1/logos',
    resource_type: 'image',
    allowed_formats: ['jpg', 'jpeg', 'png', 'svg', 'webp'],
    transformation: [
      { width: 500, height: 500, crop: 'limit', quality: 'auto' }
    ],
    public_id: (req, file) => {
      const uniqueName = `logo_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
      return uniqueName;
    }
  }
});

// Document storage (KYC, certificates etc.)
const documentStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'syncro1/documents',
    resource_type: 'auto',
    allowed_formats: ['pdf', 'jpg', 'jpeg', 'png'],
    public_id: (req, file) => {
      const fieldName = file.fieldname || 'doc';
      const uniqueName = `${fieldName}_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
      return uniqueName;
    }
  }
});

// ==================== FILE FILTERS ====================

const resumeFilter = (req, file, cb) => {
  const allowedMimes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.pdf', '.doc', '.docx'];

  if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type for resume. Allowed: PDF, DOC, DOCX'), false);
  }
};

const logoFilter = (req, file, cb) => {
  const allowedMimes = [
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'image/webp'
  ];
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.jpg', '.jpeg', '.png', '.svg', '.webp'];

  if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type for logo. Allowed: JPG, PNG, SVG, WEBP'), false);
  }
};

const documentFilter = (req, file, cb) => {
  const allowedMimes = [
    'application/pdf',
    'image/jpeg',
    'image/png'
  ];
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png'];

  if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type for ${file.fieldname}. Allowed: PDF, JPG, PNG`), false);
  }
};

// ==================== MULTER INSTANCES ====================

const uploadResume = multer({
  storage: resumeStorage,
  fileFilter: resumeFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
}).single('resume');

const uploadLogo = multer({
  storage: logoStorage,
  fileFilter: logoFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
}).single('logo');

const uploadDocument = multer({
  storage: documentStorage,
  fileFilter: documentFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
}).single('document');


const uploadPartnerDocuments = multer({
  storage: documentStorage,
  fileFilter: documentFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
}).fields([
  { name: 'panCard', maxCount: 1 },
  { name: 'gstCertificate', maxCount: 1 },
  { name: 'incorporationCertificate', maxCount: 1 },
  { name: 'authorizedSignatoryProof', maxCount: 1 },
  { name: 'addressProof', maxCount: 1 },
  { name: 'cancelledCheque', maxCount: 1 }
]);

const uploadCompanyDocuments = multer({
  storage: documentStorage,
  fileFilter: documentFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
}).fields([
  { name: 'gstCertificate', maxCount: 1 },
  { name: 'panCard', maxCount: 1 },
  { name: 'incorporationCertificate', maxCount: 1 },
  { name: 'authorizedSignatoryProof', maxCount: 1 },
  { name: 'addressProof', maxCount: 1 },
  { name: 'msme', maxCount: 1 },
  { name: 'udyamCertificate', maxCount: 1 },
  { name: 'cinNumber', maxCount: 1 },
  { name: 'otherCompanyDocument', maxCount: 1 }
]);

const uploadAny = multer({
  storage: documentStorage,
  fileFilter: documentFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
}).any();

// ==================== ERROR HANDLER ====================

const handleUploadError = (err, req, res, next) => {
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
};

// ==================== HELPER: DELETE FROM CLOUDINARY ====================

const deleteFromCloudinary = async (publicIdOrUrl) => {
  try {
    if (!publicIdOrUrl) return;

    let publicId = publicIdOrUrl;

    // If it's a full URL, extract public_id
    if (publicIdOrUrl.startsWith('http')) {
      // Extract public_id from Cloudinary URL
      const urlParts = publicIdOrUrl.split('/');
      const uploadIndex = urlParts.indexOf('upload');
      if (uploadIndex !== -1) {
        // Get everything after version number
        const pathAfterUpload = urlParts.slice(uploadIndex + 2).join('/');
        // Remove file extension
        publicId = pathAfterUpload.replace(/\.[^/.]+$/, '');
      }
    }

    const result = await cloudinary.uploader.destroy(publicId);
    console.log(`[CLOUDINARY] Deleted: ${publicId} — ${result.result}`);
    return result;
  } catch (error) {
    console.error(`[CLOUDINARY] Delete failed: ${error.message}`);
    return null;
  }
};

// ==================== EXPORTS ====================

module.exports = {
  uploadResume,
  uploadLogo,
  uploadDocument,
  uploadPartnerDocuments,
  uploadCompanyDocuments,
  uploadAny,
  handleUploadError,
  deleteFromCloudinary
};