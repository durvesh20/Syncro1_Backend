// backend/config/ai.js
const OpenAI = require('openai');

let openaiClient = null;

const initializeAI = () => {
    const enabled = process.env.AI_ENABLED === 'true';
    const apiKey = process.env.OPENAI_API_KEY;

    if (!enabled) {
        console.log('🤖 AI: Disabled');
        return null;
    }

    if (!apiKey) {
        console.log('⚠️  AI: OpenAI API key not configured');
        return null;
    }

    try {
        openaiClient = new OpenAI({ apiKey });
        console.log('🤖 AI: OpenAI configured successfully');
        return openaiClient;
    } catch (error) {
        console.error('❌ AI: OpenAI initialization failed:', error.message);
        return null;
    }
};

const getOpenAI = () => {
    if (!openaiClient) {
        initializeAI();
    }
    return openaiClient;
};

const getModel = () => {
    return process.env.OPENAI_MODEL || 'gpt-4o-mini';
};

module.exports = { initializeAI, getOpenAI, getModel };