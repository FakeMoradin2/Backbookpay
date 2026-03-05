const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const { getServicios, getServiciosAdmin, createServicio } = require('../controllers/servicios.controllers');

router.get('/', getServicios);
router.get('/admin/servicios', requireAuth, getServiciosAdmin);
router.post('/admin/servicios', requireAuth, createServicio);

module.exports = router;