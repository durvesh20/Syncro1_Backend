// backend/config/cloudinary.js
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: 'dwvmc04oo',
    api_key: '358618285558873',
    api_secret: 'Ftuw3EafdaJjWTSPuYUotWbHxxk'
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