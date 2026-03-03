const supabase = require("../config/supabase");

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Falta token Bearer" });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);

    if (userError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Token inválido o expirado" });
    }

    const authUser = userData.user;

    const { data: perfil, error: perfilError } = await supabase
      .from("usuarios")
      .select("id, correo, nombre, rol, negocio_id, activo")
      .eq("id", authUser.id)
      .single();

    if (perfilError || !perfil) {
      return res.status(401).json({ ok: false, error: "Perfil no encontrado en usuarios" });
    }

    if (!perfil.activo) {
      return res.status(403).json({ ok: false, error: "Usuario inactivo" });
    }

    req.user = perfil;
    next();
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

module.exports = requireAuth;