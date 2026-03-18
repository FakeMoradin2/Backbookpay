const supabase = require("../config/supabase");

// Admin: list all blocks for current business
const getBloqueosAdmin = async (req, res) => {
  try {
    const user = req.user;

    if (user.rol !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "Only admin can list blocks",
      });
    }

    const negocioId = user.negocio_id;

    if (!negocioId) {
      return res.status(400).json({
        ok: false,
        error: "User has no business associated",
      });
    }

    const { data, error } = await supabase
      .from("bloqueos")
      .select("*")
      .eq("negocio_id", negocioId)
      .order("inicio_en", { ascending: true });

    if (error) {
      return res.status(500).json({
        ok: false,
        step: "query bloqueos",
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

// Admin: create block
const createBloqueoAdmin = async (req, res) => {
  try {
    const user = req.user;

    if (user.rol !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "Only admin can create blocks",
      });
    }

    const negocioId = user.negocio_id;

    if (!negocioId) {
      return res.status(400).json({
        ok: false,
        error: "User has no business associated",
      });
    }

    const { inicio_en, fin_en, motivo } = req.body;

    if (!inicio_en || !fin_en) {
      return res.status(400).json({
        ok: false,
        error: "Start and end datetimes are required",
      });
    }

    const start = new Date(inicio_en);
    const end = new Date(fin_en);

    if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
      return res.status(400).json({
        ok: false,
        error: "Invalid start datetime",
      });
    }

    if (!(end instanceof Date) || Number.isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({
        ok: false,
        error: "Invalid end datetime",
      });
    }

    const { data, error } = await supabase
      .from("bloqueos")
      .insert({
        negocio_id: negocioId,
        inicio_en: start.toISOString(),
        fin_en: end.toISOString(),
        motivo: motivo || null,
      })
      .select("*")
      .single();

    if (error) {
      return res.status(500).json({
        ok: false,
        step: "insert bloqueo",
        error: error.message,
      });
    }

    return res.status(201).json({
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

// Admin: delete block (hard delete is fine here)
const deleteBloqueoAdmin = async (req, res) => {
  try {
    const user = req.user;
    const bloqueoId = req.params.id;

    if (user.rol !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "Only admin can delete blocks",
      });
    }

    const negocioId = user.negocio_id;

    if (!negocioId) {
      return res.status(400).json({
        ok: false,
        error: "User has no business associated",
      });
    }

    const { data: bloqueoActual, error: bloqueoError } = await supabase
      .from("bloqueos")
      .select("*")
      .eq("id", bloqueoId)
      .eq("negocio_id", negocioId)
      .single();

    if (bloqueoError || !bloqueoActual) {
      return res.status(404).json({
        ok: false,
        error: "Block not found",
      });
    }

    const { error } = await supabase
      .from("bloqueos")
      .delete()
      .eq("id", bloqueoId)
      .eq("negocio_id", negocioId);

    if (error) {
      return res.status(500).json({
        ok: false,
        step: "delete bloqueo",
        error: error.message,
      });
    }

    return res.json({
      ok: true,
      data: bloqueoActual,
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
  getBloqueosAdmin,
  createBloqueoAdmin,
  deleteBloqueoAdmin,
};

