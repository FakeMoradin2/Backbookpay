const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");

const { getPagosNegocio } = require("../controllers/pagos.controllers");

router.get("/admin/pagos", requireAuth, getPagosNegocio);

module.exports = router;

