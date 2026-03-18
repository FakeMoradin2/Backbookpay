const supabase = require("../config/supabase");

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

module.exports = {
  getMiPerfil,
  updateMiPerfil,
};

