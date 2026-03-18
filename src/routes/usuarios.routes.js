const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");

const { getMiPerfil, updateMiPerfil } = require("../controllers/usuarios.controllers");

router.get("/me", requireAuth, getMiPerfil);
router.patch("/me", requireAuth, updateMiPerfil);

module.exports = router;

