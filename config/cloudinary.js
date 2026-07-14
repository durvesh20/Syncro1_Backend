// backend/config/cloudinary.js
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME ,
    api_key: process.env.CLOUDINARY_API_KEY ,
    api_secret: process.env.CLOUDINARY_API_SECRET ,
    timeout: 120000  // 120s upload timeout (default is too low for large PDFs)
});

// Test connection
const testConnection = async () => {
    try {
        const result = await cloudinary.api.ping();
        console.log('☁️  Cloudinary connected:', result.status);
        return true;
    } catch (error) {
        console.error('❌ Cloudinary connection failed:', error.message);
        return false;
    }
};

module.exports = { cloudinary, testConnection };