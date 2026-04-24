const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");
const {
  createCheckoutSession,
  completeAdminSetup,
  createConnectAccountLink,
  syncConnectStatusAdmin,
  verifyDepositCheckoutSessionCliente,
  cancelPendingDepositReservationCliente,
  createDepositCheckoutSession,
  createDepositCheckoutSessionPublic,
} = require("../controllers/stripe.controllers");

router.post("/create-checkout-session", createCheckoutSession);
router.post("/complete-admin-setup", completeAdminSetup);
router.post("/connect/account-link", requireAuth, createConnectAccountLink);
router.post("/connect/sync-status", requireAuth, syncConnectStatusAdmin);
router.post("/deposit-verify-session", requireAuth, verifyDepositCheckoutSessionCliente);
router.post("/deposit-cancel-pending", requireAuth, cancelPendingDepositReservationCliente);
router.post("/deposit-checkout", requireAuth, createDepositCheckoutSession);
router.post("/deposit-checkout-public", createDepositCheckoutSessionPublic);

module.exports = router;
