const express = require('express');
const router = express.Router();
const cityController = require('../controllers/citySuggestionController');

router.get('/suggestions', cityController.getCitySuggestions);

module.exports = router;