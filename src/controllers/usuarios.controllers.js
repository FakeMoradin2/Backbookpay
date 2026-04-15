const supabase = require("../config/supabase");
const { createClient } = require("@supabase/supabase-js");
const ACTIVE_RESERVA_STATES = ["pendiente_pago", "confirmada"];

let supabaseAdmin = null;
function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  supabaseAdmin = createClient(url, serviceKey);
  return supabaseAdmin;
}

const getMiPerfil = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from("usuarios")
      .select("id, nombre, correo, telefono, rol, negocio_id, activo, creado_en")
      .eq("id", userId)
      .single();

    if (error || !data) {
      return res.status(404).json({
        ok: false,
        error: "Profile not found",
      });
    }

    return res.json({
      ok: true,
      data,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

const updateMiPerfil = async (req, res) => {
  try {
    const userId = req.user.id;
    const { nombre, correo, telefono } = req.body;

    const updateData = {};

    if (nombre !== undefined) {
      const value = String(nombre).trim();
      if (!value) {
        return res.status(400).json({
          ok: false,
          error: "nombre cannot be empty",
        });
      }
      updateData.nombre = value;
    }

    if (correo !== undefined) {
      const value = String(correo).trim();
      if (!value) {
        return res.status(400).json({
          ok: false,
          error: "correo cannot be empty",
        });
      }
      updateData.correo = value;
    }

    if (telefono !== undefined) {
      updateData.telefono = String(telefono || "").trim() || null;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No fields were provided for update",
      });
    }

    const { data, error } = await supabase
      .from("usuarios")
      .update(updateData)
      .eq("id", userId)
      .select("id, nombre, correo, telefono, rol, negocio_id, activo, creado_en")
      .single();

    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
      });
    }

    return res.json({
      ok: true,
      data,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

const listStaffAdmin = async (req, res) => {
  try {
    const user = req.user;
    if (!["admin", "staff"].includes(user.rol)) {
      return res.status(403).json({
        ok: false,
        error: "Only admin or staff can list staff",
      });
    }

    if (!user.negocio_id) {
      return res.status(400).json({
        ok: false,
        error: "User has no business associated",
      });
    }

    const { data, error } = await supabase
      .from("usuarios")
      .select("id, nombre, correo, telefono, rol, activo, creado_en")
      .eq("negocio_id", user.negocio_id)
      .eq("rol", "staff")
      .order("creado_en", { ascending: true });

    if (error) {
      return res.status(500).json({
        ok: false,
        step: "query staff",
        error: error.message,
      });
    }

    return res.json({
      ok: true,
      data: data || [],
      count: data ? data.length : 0,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

const createStaffAdmin = async (req, res) => {
  try {
    const user = req.user;
    if (user.rol !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "Only admin can create staff users",
      });
    }

    const negocioId = user.negocio_id;
    if (!negocioId) {
      return res.status(400).json({
        ok: false,
        error: "User has no business associated",
      });
    }

    const { nombre, correo, telefono, password } = req.body;
    const name = String(nombre || "").trim();
    const email = String(correo || "").trim().toLowerCase();
    const phone = String(telefono || "").trim() || null;
    const pass = String(password || "");

    if (!name || !email || !pass) {
      return res.status(400).json({
        ok: false,
        error: "nombre, correo and password are required",
      });
    }

    if (pass.length < 6) {
      return res.status(400).json({
        ok: false,
        error: "Password must be at least 6 characters",
      });
    }

    const { data: existingProfile } = await supabase
      .from("usuarios")
      .select("id")
      .ilike("correo", email)
      .maybeSingle();

    if (existingProfile) {
      return res.status(409).json({
        ok: false,
        error: "This email is already registered",
      });
    }

    const adminClient = getSupabaseAdmin();
    if (!adminClient) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing SUPABASE_SERVICE_ROLE_KEY in backend environment (.env). Add it and restart the API to create staff accounts.",
      });
    }

    const { data: signUpData, error: signUpError } = await adminClient.auth.admin.createUser({
      email,
      password: pass,
      email_confirm: true,
      user_metadata: { full_name: name },
    });

    if (signUpError) {
      const msg = String(signUpError.message || "").toLowerCase();
      const duplicate =
        msg.includes("already") ||
        msg.includes("registered") ||
        msg.includes("exists") ||
        msg.includes("duplicate");
      return res.status(duplicate ? 409 : 400).json({
        ok: false,
        error: duplicate ? "This email is already registered" : signUpError.message,
      });
    }

    const userId = signUpData?.user?.id;
    if (!userId) {
      return res.status(500).json({
        ok: false,
        error: "Could not create auth user for staff",
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from("usuarios")
      .update({
        nombre: name,
        correo: email,
        telefono: phone,
        rol: "staff",
        negocio_id: negocioId,
        activo: true,
      })
      .eq("id", userId)
      .select("id, nombre, correo, telefono, rol, activo, creado_en")
      .single();

    if (profileError) {
      return res.status(500).json({
        ok: false,
        step: "update staff profile",
        error: profileError.message,
      });
    }

    return res.status(201).json({
      ok: true,
      data: profile,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

const setStaffActiveAdmin = async (req, res) => {
  try {
    const user = req.user;
    if (user.rol !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "Only admin can update staff availability",
      });
    }

    const negocioId = user.negocio_id;
    if (!negocioId) {
      return res.status(400).json({
        ok: false,
        error: "User has no business associated",
      });
    }

    const staffId = req.params.id;
    const { activo } = req.body;
    if (typeof activo !== "boolean") {
      return res.status(400).json({
        ok: false,
        error: "activo must be a boolean",
      });
    }

    const { data: staff, error: staffError } = await supabase
      .from("usuarios")
      .select("id, nombre, activo, rol, negocio_id")
      .eq("id", staffId)
      .eq("rol", "staff")
      .eq("negocio_id", negocioId)
      .single();

    if (staffError || !staff) {
      return res.status(404).json({
        ok: false,
        error: "Staff member not found",
      });
    }

    if (!activo) {
      const nowIso = new Date().toISOString();
      const { data: activeBookings, error: bookingsError } = await supabase
        .from("reservas")
        .select("id, inicio_en, fin_en, estado")
        .eq("negocio_id", negocioId)
        .eq("staff_id", staffId)
        .in("estado", ACTIVE_RESERVA_STATES)
        .gt("fin_en", nowIso)
        .order("inicio_en", { ascending: true });

      if (bookingsError) {
        return res.status(500).json({
          ok: false,
          step: "query staff active bookings",
          error: bookingsError.message,
        });
      }

      if (Array.isArray(activeBookings) && activeBookings.length > 0) {
        return res.status(409).json({
          ok: false,
          error:
            "This staff member has upcoming reservations. Please reassign or reschedule those clients before deactivating.",
          conflicts_count: activeBookings.length,
          conflicts: activeBookings,
        });
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from("usuarios")
      .update({ activo })
      .eq("id", staffId)
      .eq("rol", "staff")
      .eq("negocio_id", negocioId)
      .select("id, nombre, correo, telefono, rol, activo, creado_en")
      .single();

    if (updateError) {
      return res.status(500).json({
        ok: false,
        step: "update staff active",
        error: updateError.message,
      });
    }

    return res.json({
      ok: true,
      data: updated,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

const listPublicStaffByBusiness = async (req, res) => {
  try {
    const negocioId = String(req.query.negocio_id || "").trim();
    if (!negocioId) {
      return res.status(400).json({
        ok: false,
        error: "negocio_id is required",
      });
    }

    const { data, error } = await supabase
      .from("usuarios")
      .select("id, nombre")
      .eq("negocio_id", negocioId)
      .eq("rol", "staff")
      .eq("activo", true)
      .order("nombre", { ascending: true });

    if (error) {
      return res.status(500).json({
        ok: false,
        step: "query public staff",
        error: error.message,
      });
    }

    return res.json({
      ok: true,
      data: data || [],
      count: data ? data.length : 0,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

module.exports = {
  getMiPerfil,
  updateMiPerfil,
  listStaffAdmin,
  createStaffAdmin,
  setStaffActiveAdmin,
  listPublicStaffByBusiness,
};

