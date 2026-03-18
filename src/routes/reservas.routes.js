const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");

const {
  createReservaCliente,
  createReservaAdmin,
  getDisponibilidadPublic,
  getFechasDisponiblesPublic,
  getReservasCliente,
  getReservasNegocio,
  updateReservaEstado,
  cancelReservaCliente,
} = require("../controllers/reservas.controllers");

// Public
router.get("/public/disponibilidad", getDisponibilidadPublic);
router.get("/public/fechas-disponibles", getFechasDisponiblesPublic);

// Client
router.get("/cliente/mis-reservas", requireAuth, getReservasCliente);
router.post("/cliente/reservas", requireAuth, createReservaCliente);
router.post("/cliente/reservas/:id/cancel", requireAuth, cancelReservaCliente);

// Admin / Staff
router.post("/admin/reservas", requireAuth, createReservaAdmin);
router.get("/admin/reservas", requireAuth, getReservasNegocio);
router.patch("/admin/reservas/:id/estado", requireAuth, updateReservaEstado);

module.exports = router;

