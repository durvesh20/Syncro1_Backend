const cityService = require('../services/CitySuggestionService');

exports.getCitySuggestions = async (req, res) => {
    try {
        const { q, state } = req.query;

        if (!q) {
            return res.status(400).json({
                success: false,
                message: 'Query parameter "q" is required (minimum 2 characters)'
            });
        }

        const suggestions = await cityService.getCitySuggestions(q, state);

        res.json({
            success: true,
            results: suggestions,
            count: suggestions.length
        });

    } catch (error) {
        console.error('[City Suggestions Error]:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};