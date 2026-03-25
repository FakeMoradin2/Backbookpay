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

/**
 * Stripe webhook. Handles checkout.session.completed to create admin account.
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

    if (session.metadata?.type !== "admin_upgrade") {
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

module.exports = {
  createCheckoutSession,
  handleWebhook,
  completeAdminSetup,
};
