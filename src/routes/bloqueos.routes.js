const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");

const {
  getBloqueosAdmin,
  createBloqueoAdmin,
  deleteBloqueoAdmin,
} = require("../controllers/bloqueos.controllers");

router.get("/admin/bloqueos", requireAuth, getBloqueosAdmin);
router.post("/admin/bloqueos", requireAuth, createBloqueoAdmin);
router.delete("/admin/bloqueos/:id", requireAuth, deleteBloqueoAdmin);

module.exports = router;

