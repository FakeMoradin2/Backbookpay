const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/requireAuth');

const {
  getNegocios,
  getNegocioPublic,
  getNegocioAdmin,
  updateNegocioAdmin
} = require('../controllers/negocios.controllers');

// público
router.get('/negocios', getNegocios);
router.get('/negocios/:id', getNegocioPublic);
// admin
router.get('/admin/negocio', requireAuth, getNegocioAdmin);
router.patch('/admin/negocio', requireAuth, updateNegocioAdmin);


module.exports = router;