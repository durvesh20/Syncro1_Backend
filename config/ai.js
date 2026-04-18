const { GoogleGenerativeAI } = require('@google/generative-ai');

let geminiClient = null;

const initializeAI = () => {
    const enabled = process.env.AI_ENABLED === 'true';
    const apiKey = process.env.GEMINI_API_KEY;

    if (!enabled) {
        console.log('🤖 AI: Disabled');
        return null;
    }

    if (!apiKey) {
        console.log('⚠️  AI: Gemini API key not configured');
        return null;
    }

    try {
        geminiClient = new GoogleGenerativeAI(apiKey);
        console.log('🤖 AI: Gemini configured successfully');
        return geminiClient;
    } catch (error) {
        console.error('❌ AI: Gemini initialization failed:', error.message);
        return null;
    }
};

const getGemini = () => {
    if (!geminiClient) {
        initializeAI();
    }
    return geminiClient;
};

const getModel = () => {
    return process.env.GEMINI_MODEL || 'gemini-1.5-flash';
};

module.exports = { initializeAI, getGemini, getModel };