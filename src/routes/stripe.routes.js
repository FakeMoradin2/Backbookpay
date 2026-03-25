const express = require("express");
const router = express.Router();
const {
  createCheckoutSession,
  completeAdminSetup,
} = require("../controllers/stripe.controllers");

router.post("/create-checkout-session", createCheckoutSession);
router.post("/complete-admin-setup", completeAdminSetup);

module.exports = router;
