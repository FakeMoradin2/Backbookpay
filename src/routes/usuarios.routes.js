const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");

const {
  getMiPerfil,
  updateMiPerfil,
  listStaffAdmin,
  createStaffAdmin,
  setStaffActiveAdmin,
  listPublicStaffByBusiness,
} = require("../controllers/usuarios.controllers");

router.get("/me", requireAuth, getMiPerfil);
router.patch("/me", requireAuth, updateMiPerfil);
router.get("/admin/staff", requireAuth, listStaffAdmin);
router.post("/admin/staff", requireAuth, createStaffAdmin);
router.patch("/admin/staff/:id/active", requireAuth, setStaffActiveAdmin);
router.get("/public/staff", listPublicStaffByBusiness);

module.exports = router;

