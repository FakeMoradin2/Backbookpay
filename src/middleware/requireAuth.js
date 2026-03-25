const supabase = require("../config/supabase");

function isSupabaseNetworkError(error) {
  const message = (error?.message || "").toLowerCase();
  const causeCode = error?.cause?.code;
  const causeMessage = (error?.cause?.message || "").toLowerCase();

  return (
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    causeMessage.includes("timeout") ||
    causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
    causeCode === "ETIMEDOUT" ||
    causeCode === "ECONNREFUSED" ||
    causeCode === "ENOTFOUND"
  );
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Bearer token" });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);

    if (userError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Invalid or expired token" });
    }

    const authUser = userData.user;

    const { data: perfil, error: perfilError } = await supabase
      .from("usuarios")
      .select("id, correo, nombre, rol, negocio_id, activo")
      .eq("id", authUser.id)
      .single();

    if (perfilError || !perfil) {
      return res.status(401).json({ ok: false, error: "User profile not found" });
    }

    if (!perfil.activo) {
      return res.status(403).json({ ok: false, error: "Inactive user" });
    }

    req.user = perfil;
    next();
  } catch (e) {
    if (isSupabaseNetworkError(e)) {
      return res.status(503).json({
        ok: false,
        error: "Authentication provider unavailable. Try again in a moment.",
      });
    }

    return res.status(500).json({ ok: false, error: e.message });
  }
}

module.exports = requireAuth;