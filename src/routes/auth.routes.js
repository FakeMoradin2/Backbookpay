const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');

const { login, me, register, refresh, logout } = require('../controllers/auth.controllers');

router.post('/login', login);
router.get('/me', requireAuth, me);
router.post('/register', register);
router.post('/refresh', refresh);
router.post('/logout', logout);

module.exports = router;