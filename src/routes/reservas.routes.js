const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");

const {
  createReservaCliente,
  createReservaAdmin,
  createReservaPublic,
  getDisponibilidadPublic,
  getFechasDisponiblesPublic,
  getReservasCliente,
  getReservasNegocio,
  updateReservaEstado,
  cancelReservaCliente,
  reagendarReservaCliente,
  reagendarReservaAdmin,
  reassignReservaStaffAdmin,
} = require("../controllers/reservas.controllers");

// Public
router.get("/public/disponibilidad", getDisponibilidadPublic);
router.get("/public/fechas-disponibles", getFechasDisponiblesPublic);
router.post("/public/reservas", createReservaPublic);

// Client
router.get("/cliente/mis-reservas", requireAuth, getReservasCliente);
router.post("/cliente/reservas", requireAuth, createReservaCliente);
router.post("/cliente/reservas/:id/cancel", requireAuth, cancelReservaCliente);
router.patch("/cliente/reservas/:id/reagendar", requireAuth, reagendarReservaCliente);

// Admin / Staff
router.post("/admin/reservas", requireAuth, createReservaAdmin);
router.get("/admin/reservas", requireAuth, getReservasNegocio);
router.patch("/admin/reservas/:id/estado", requireAuth, updateReservaEstado);
router.patch("/admin/reservas/:id/reagendar", requireAuth, reagendarReservaAdmin);
router.patch("/admin/reservas/:id/staff", requireAuth, reassignReservaStaffAdmin);

module.exports = router;

