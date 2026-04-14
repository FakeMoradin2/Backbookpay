const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");
const {
  createCheckoutSession,
  completeAdminSetup,
  createConnectAccountLink,
  createDepositCheckoutSession,
} = require("../controllers/stripe.controllers");

router.post("/create-checkout-session", createCheckoutSession);
router.post("/complete-admin-setup", completeAdminSetup);
router.post("/connect/account-link", requireAuth, createConnectAccountLink);
router.post("/deposit-checkout", requireAuth, createDepositCheckoutSession);

module.exports = router;
