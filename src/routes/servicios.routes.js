const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const { getServicios, getServiciosAdmin, createServicio, updateServicio, deleteServicio } = require('../controllers/servicios.controllers');

router.get('/', getServicios);
router.get('/admin/servicios', requireAuth, getServiciosAdmin);
router.post('/admin/servicios', requireAuth, createServicio);
router.patch('/admin/servicios/:id', requireAuth, updateServicio);
router.delete('/admin/servicios/:id', requireAuth, deleteServicio);

module.exports = router;