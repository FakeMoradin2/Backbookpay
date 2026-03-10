const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/requireAuth');

const {
  getHorariosAdmin,
  createHorarioAdmin,
  updateHorarioAdmin,
  deleteHorarioAdmin,
} = require('../controllers/horarios.controllers');

router.get('/admin/horarios', requireAuth, getHorariosAdmin);
router.post('/admin/horarios', requireAuth, createHorarioAdmin);
router.patch('/admin/horarios/:id', requireAuth, updateHorarioAdmin);
router.delete('/admin/horarios/:id', requireAuth, deleteHorarioAdmin);

module.exports = router;