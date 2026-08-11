const express = require('express');
const router = express.Router();
const cityController = require('../controllers/citySuggestionController');

router.get('/suggestions', cityController.getCitySuggestions);
router.get('/states', cityController.getStateSuggestions);

module.exports = router;