const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const { getHorarios } = require('../controllers/horarios.controllers');

router.get('/admin/horarios', requireAuth, getHorarios);

module.exports = router;