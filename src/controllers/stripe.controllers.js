const Stripe = require("stripe");
const supabase = require("../config/supabase");

/** Trim, strip CR/LF quirks, and optional surrounding quotes from .env values. */
function normalizeEnvSecret(raw) {
  if (raw == null || typeof raw !== "string") return "";
  let k = raw.replace(/\r/g, "").trim();
  if (
    (k.startsWith('"') && k.endsWith('"')) ||
    (k.startsWith("'") && k.endsWith("'"))
  ) {
    k = k.slice(1, -1).trim();
  }
  return k;
}

const stripeKey = normalizeEnvSecret(process.env.STRIPE_SECRET_KEY);
const stripe = stripeKey ? new Stripe(stripeKey) : null;

function getStripeCurrency() {
  return (normalizeEnvSecret(process.env.STRIPE_CURRENCY) || "mxn").toLowerCase();
}

function platformFeeAmountCents(totalCents) {
  const pct = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT || "0");
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.min(Math.floor((totalCents * pct) / 100), totalCents - 1);
}

/**
 * Creates a Stripe Checkout session to purchase an admin account.
 * Receives: { nombre, email }
 */
const createCheckoutSession = async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({
        ok: false,
        error: "Stripe is not configured (STRIPE_SECRET_KEY)",
      });
    }

    const { nombre, email } = req.body;

    if (!nombre || !email) {
      return res.status(400).json({
        ok: false,
        error: "Name and email are required",
      });
    }

    const emailTrim = String(email).trim().toLowerCase();
    const nombreTrim = String(nombre).trim();

    if (!emailTrim || !nombreTrim) {
      return res.status(400).json({
        ok: false,
        error: "Name and email cannot be empty",
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: process.env.STRIPE_CURRENCY || "mxn",
            product_data: {
              name: "Book&Pay - Admin Account",
              description: "Access to the admin panel. Manage your business, services, schedule and payments.",
              images: [],
            },
            unit_amount: parseInt(process.env.STRIPE_PRICE_CENTS || "9900", 10),
          },
          quantity: 1,
        },
      ],
      customer_email: emailTrim,
      // Lets customers enter a Promotion code at Stripe Checkout (Dashboard → Product catalog → Coupons).
      allow_promotion_codes: true,
      metadata: {
        customer_name: nombreTrim,
        customer_email: emailTrim,
        type: "admin_upgrade",
      },
      success_url: `${frontendUrl}/auth/complete-setup?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/pricing?canceled=1`,
    });

    return res.json({
      ok: true,
      url: session.url,
      session_id: session.id,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || "Error creating payment session",
    });
  }
};

async function syncConnectAccountFromStripe(account) {
  const id = account?.id;
  if (!id) return;
  await supabase
    .from("negocios")
    .update({
      stripe_connect_charges_enabled: !!account.charges_enabled,
      stripe_connect_details_submitted: !!account.details_submitted,
    })
    .eq("stripe_connect_account_id", id);
}

async function handleDepositSessionCompleted(session) {
  const reservaId = session.metadata?.reserva_id;
  if (!reservaId) {
    throw new Error("Missing reserva_id in session metadata");
  }

  const paymentOk =
    session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (session.status !== "complete" || !paymentOk) {
    throw new Error("Deposit payment not complete");
  }

  const { data: reserva, error: rErr } = await supabase
    .from("reservas")
    .select("id, estado, anticipo_calculado, precio_total, negocio_id")
    .eq("id", reservaId)
    .single();

  if (rErr || !reserva) {
    throw new Error("Reservation not found");
  }

  if (reserva.estado !== "pendiente_pago") {
    return;
  }

  const expectedCents = Math.round(Number(reserva.anticipo_calculado) * 100);
  if (session.amount_total != null && Number(session.amount_total) !== expectedCents) {
    throw new Error("Payment amount does not match reservation deposit");
  }

  const monto = Number(reserva.anticipo_calculado);
  const currency = getStripeCurrency();

  const { data: existingPago } = await supabase
    .from("pagos")
    .select("id")
    .eq("reserva_id", reservaId)
    .eq("tipo", "anticipo")
    .eq("estado", "pagado")
    .maybeSingle();

  if (existingPago) {
    return;
  }

  const referencia = session.payment_intent || session.id;

  const { error: pErr } = await supabase.from("pagos").insert({
    reserva_id: reservaId,
    tipo: "anticipo",
    monto,
    moneda: currency,
    metodo: "stripe",
    estado: "pagado",
    referencia: String(referencia),
  });

  if (pErr) {
    throw new Error(pErr.message);
  }

  const remaining = Math.max(Number(reserva.precio_total || 0) - monto, 0);

  const { error: uErr } = await supabase
    .from("reservas")
    .update({
      estado: "confirmada",
      saldo_pendiente: remaining,
    })
    .eq("id", reservaId);

  if (uErr) {
    throw new Error(uErr.message);
  }
}

/**
 * Stripe webhook: admin checkout, deposit checkout, Connect account updates.
 */
const handleWebhook = async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ ok: false, error: "Stripe is not configured" });
  }

  const sig = req.headers["stripe-signature"];
  const webhookSecret = normalizeEnvSecret(process.env.STRIPE_WEBHOOK_SECRET);

  if (!webhookSecret) {
    console.warn("STRIPE_WEBHOOK_SECRET not configured, webhook disabled");
    return res.status(500).json({ ok: false, error: "Webhook not configured" });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).json({ ok: false, error: `Webhook Error: ${err.message}` });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const metaType = session.metadata?.type;

    if (metaType === "deposit_payment") {
      try {
        await handleDepositSessionCompleted(session);
      } catch (e) {
        console.error("Webhook: deposit payment:", e);
        return res.status(500).json({ ok: false, error: e.message });
      }
      return res.json({ ok: true, received: true });
    }

    if (metaType !== "admin_upgrade") {
      return res.json({ ok: true, received: true });
    }

    const email = session.metadata?.customer_email;
    const nombre = session.metadata?.customer_name || "Admin";

    if (!email) {
      console.error("Webhook: missing email in metadata");
      return res.status(400).json({ ok: false, error: "Incomplete metadata" });
    }

    try {
      await createAdminFromStripePayment(email, nombre);
    } catch (e) {
      console.error("Webhook: error creating admin:", e);
      return res.status(500).json({ ok: false, error: e.message });
    }

    return res.json({ ok: true, received: true });
  }

  if (event.type === "account.updated") {
    try {
      await syncConnectAccountFromStripe(event.data.object);
    } catch (e) {
      console.error("Webhook: account.updated:", e);
    }
    return res.json({ ok: true, received: true });
  }

  return res.json({ ok: true, received: true });
};

/**
 * Completes admin registration after successful payment.
 * User arrives with session_id, enters password, and we create the account.
 */
const completeAdminSetup = async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({
        ok: false,
        error: "Stripe is not configured",
      });
    }

    const { session_id, password } = req.body;

    if (!session_id || !password) {
      return res.status(400).json({
        ok: false,
        error: "session_id and password are required",
      });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["payment_intent"],
    });

    const paymentOk =
      session.payment_status === "paid" ||
      session.payment_status === "no_payment_required";
    if (session.status !== "complete" || !paymentOk) {
      return res.status(400).json({
        ok: false,
        error: "Payment is not complete or has not been verified",
      });
    }

    if (session.metadata?.type !== "admin_upgrade") {
      return res.status(400).json({
        ok: false,
        error: "Invalid session",
      });
    }

    const email = session.metadata?.customer_email;
    const nombre = session.metadata?.customer_name || "Admin";

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "Email not found in session",
      });
    }

    const user = await createAdminFromStripePayment(email, nombre, password);

    return res.json({
      ok: true,
      access_token: user.access_token,
      refresh_token: user.refresh_token,
      expires_in: user.expires_in,
      token_type: user.token_type,
      user_id: user.user_id,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || "Error completing registration",
    });
  }
};

/**
 * Creates or upgrades to admin account from a Stripe payment.
 * - New user: signUp + create negocio + update usuario
 * - Existing cliente: create negocio + update usuario (upgrade to admin)
 * - Existing admin: throw
 * If passwordProvided and from complete-setup: signs in and returns tokens.
 * @returns {Object} With access_token, refresh_token, etc. if session; or { user_id }
 */
async function createAdminFromStripePayment(email, nombre, passwordProvided) {
  const { data: existingUser } = await supabase
    .from("usuarios")
    .select("id, rol")
    .eq("correo", email)
    .maybeSingle();

  let userId;

  if (existingUser?.rol === "admin") {
    throw new Error("An admin account with this email already exists");
  }

  if (existingUser?.rol === "cliente") {
    userId = existingUser.id;
  } else {
    const password = passwordProvided || generateRandomPassword();
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: nombre },
        emailRedirectTo: undefined,
      },
    });

    if (authError) {
      if (authError.message?.includes("already been registered")) {
        throw new Error("This email is already registered. Sign in or use a different email.");
      }
      throw new Error(authError.message);
    }

    userId = authData?.user?.id;
    if (!userId) {
      throw new Error("Could not get user ID");
    }
  }

  const { data: negocioCreado, error: negocioError } = await supabase
    .from("negocios")
    .insert({
      nombre: `${nombre}'s business`,
      zona_horaria: "america/mexico_city",
      duracion_buffer_min: 0,
      activo: true,
    })
    .select("id")
    .single();

  if (negocioError) {
    throw new Error(negocioError.message);
  }

  const { error: perfilError } = await supabase
    .from("usuarios")
    .update({
      nombre,
      rol: "admin",
      negocio_id: negocioCreado.id,
      activo: true,
    })
    .eq("id", userId);

  if (perfilError) {
    throw new Error(perfilError.message);
  }

  if (passwordProvided) {
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: passwordProvided,
    });

    if (signInError) {
      if (existingUser?.rol === "cliente") {
        throw new Error("Please enter your current account password to confirm the upgrade.");
      }
      throw new Error(signInError.message);
    }

    if (signInData?.session) {
      return {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        expires_in: signInData.session.expires_in,
        token_type: signInData.session.token_type,
        user_id: signInData.user?.id || userId,
      };
    }
  }

  return { user_id: userId };
}

function generateRandomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let result = "";
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Admin: Stripe Connect Express onboarding (receive deposits from clients).
 */
const createConnectAccountLink = async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ ok: false, error: "Stripe is not configured" });
    }
    if (req.user.rol !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "Only business administrators can connect Stripe payouts",
      });
    }
    const negocioId = req.user.negocio_id;
    if (!negocioId) {
      return res.status(400).json({ ok: false, error: "No business associated" });
    }

    const { data: negocio, error: nErr } = await supabase
      .from("negocios")
      .select("id, correo, nombre, stripe_connect_account_id")
      .eq("id", negocioId)
      .single();

    if (nErr || !negocio) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    const frontendUrl = normalizeEnvSecret(process.env.FRONTEND_URL) || "http://localhost:3000";
    const country = normalizeEnvSecret(process.env.STRIPE_CONNECT_DEFAULT_COUNTRY) || "MX";

    let accountId = negocio.stripe_connect_account_id;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country,
        email: negocio.correo || req.user.correo || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          name: negocio.nombre || undefined,
        },
        metadata: {
          negocio_id: String(negocioId),
        },
      });
      accountId = account.id;
      const { error: upErr } = await supabase
        .from("negocios")
        .update({ stripe_connect_account_id: accountId })
        .eq("id", negocioId);
      if (upErr) {
        return res.status(500).json({ ok: false, error: upErr.message });
      }
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${frontendUrl}/dashboard/payments?connect=refresh`,
      return_url: `${frontendUrl}/dashboard/payments?connect=return`,
      type: "account_onboarding",
    });

    return res.json({ ok: true, url: accountLink.url });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || "Stripe Connect error",
    });
  }
};

/**
 * Client: hosted Checkout to pay reservation deposit (Connect destination charge).
 */
const createDepositCheckoutSession = async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ ok: false, error: "Stripe is not configured" });
    }
    if (req.user.rol !== "cliente") {
      return res.status(403).json({ ok: false, error: "Only clients can pay deposits" });
    }

    const { reserva_id } = req.body;
    if (!reserva_id) {
      return res.status(400).json({ ok: false, error: "reserva_id is required" });
    }

    const { data: reserva, error: rErr } = await supabase
      .from("reservas")
      .select(
        "id, usuario_id, negocio_id, estado, anticipo_calculado, precio_total"
      )
      .eq("id", reserva_id)
      .single();

    if (rErr || !reserva) {
      return res.status(404).json({ ok: false, error: "Reservation not found" });
    }

    if (reserva.usuario_id !== req.user.id) {
      return res.status(403).json({ ok: false, error: "Not your reservation" });
    }

    if (reserva.estado !== "pendiente_pago") {
      return res.status(400).json({
        ok: false,
        error: "Reservation does not require this payment",
      });
    }

    const deposit = Number(reserva.anticipo_calculado);
    if (!Number.isFinite(deposit) || deposit <= 0) {
      return res.status(400).json({ ok: false, error: "No deposit amount for this reservation" });
    }

    const { data: negocio, error: nErr } = await supabase
      .from("negocios")
      .select("id, nombre, stripe_connect_account_id, stripe_connect_charges_enabled, activo")
      .eq("id", reserva.negocio_id)
      .single();

    if (nErr || !negocio || !negocio.activo) {
      return res.status(400).json({ ok: false, error: "Business not available" });
    }

    if (!negocio.stripe_connect_account_id || !negocio.stripe_connect_charges_enabled) {
      return res.status(400).json({
        ok: false,
        error: "This business is not accepting online deposits yet",
      });
    }

    const currency = getStripeCurrency();
    const amountCents = Math.round(deposit * 100);
    if (amountCents < 50) {
      return res.status(400).json({ ok: false, error: "Deposit amount is too small to charge" });
    }

    const feeCents = platformFeeAmountCents(amountCents);
    const frontendUrl = normalizeEnvSecret(process.env.FRONTEND_URL) || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: req.user.correo || undefined,
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: amountCents,
            product_data: {
              name: "Reservation deposit",
              description: negocio.nombre ? `Booking at ${negocio.nombre}` : "Booking deposit",
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: feeCents > 0 ? feeCents : undefined,
        transfer_data: {
          destination: negocio.stripe_connect_account_id,
        },
      },
      metadata: {
        type: "deposit_payment",
        reserva_id: String(reserva.id),
        negocio_id: String(negocio.id),
      },
      success_url: `${frontendUrl}/client/reservations?deposit=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/client/reservations?deposit=canceled`,
    });

    return res.json({
      ok: true,
      url: session.url,
      session_id: session.id,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || "Could not start payment",
    });
  }
};

module.exports = {
  createCheckoutSession,
  handleWebhook,
  completeAdminSetup,
  createConnectAccountLink,
  createDepositCheckoutSession,
};
