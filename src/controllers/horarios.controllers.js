const supabase = require("../config/supabase");

// Helper to validate allowed weekday values
const diasValidos = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];

// Helper to detect overlap between two schedule blocks
// Adjacent blocks are allowed, for example:
// 09:00-13:00 y 13:00-18:00 
const haySolapamiento = (inicioA, finA, inicioB, finB) => {
  return inicioA < finB && finA > inicioB;
};

const ORDEN_DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];

/**
 * Inserts one schedule block. Returns { ok: true, data } or { ok: false, error }.
 */
async function insertHorarioNegocio(negocioId, dia_semana, hora_inicio, hora_fin, activo = true) {
  const { data: horariosExistentes, error: errorExistentes } = await supabase
    .from("horarios")
    .select("*")
    .eq("negocio_id", negocioId)
    .eq("dia_semana", dia_semana)
    .eq("activo", true);

  if (errorExistentes) {
    return { ok: false, error: errorExistentes.message };
  }

  for (const horario of horariosExistentes || []) {
    if (haySolapamiento(hora_inicio, hora_fin, horario.hora_inicio, horario.hora_fin)) {
      return { ok: false, error: "The schedule overlaps with an existing block" };
    }
  }

  const { data, error } = await supabase
    .from("horarios")
    .insert({
      negocio_id: negocioId,
      dia_semana,
      hora_inicio,
      hora_fin,
      activo,
    })
    .select("*")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, data };
}

const getHorariosAdmin = async (req, res) => {
  try {
    const negocioId = req.user.negocio_id;

    const { data, error } = await supabase
      .from("horarios")
      .select("*")
      .eq("negocio_id", negocioId)
      .eq("activo", true)
      .order("dia_semana", { ascending: true })
      .order("hora_inicio", { ascending: true });

    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
      });
    }

    return res.status(200).json({
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

const createHorarioAdmin = async (req, res) => {
  try {
    const rolUser = req.user.rol;
    const negocioId = req.user.negocio_id;

    if (rolUser !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "You do not have permission to create schedules",
      });
    }

    const {
      dia_semana,
      hora_inicio,
      hora_fin,
      activo = true,
    } = req.body;

    // Basic validations
    if (!dia_semana || !hora_inicio || !hora_fin) {
      return res.status(400).json({
        ok: false,
        error: "dia_semana, hora_inicio and hora_fin are required",
      });
    }

    if (!diasValidos.includes(dia_semana)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid dia_semana value",
      });
    }

    if (hora_inicio >= hora_fin) {
      return res.status(400).json({
        ok: false,
        error: "hora_inicio must be earlier than hora_fin",
      });
    }

    const result = await insertHorarioNegocio(negocioId, dia_semana, hora_inicio, hora_fin, activo);
    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        error: result.error,
      });
    }

    return res.status(201).json({
      ok: true,
      data: result.data,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

const updateHorarioAdmin = async (req, res) => {
  try {
    const rolUser = req.user.rol;
    const negocioId = req.user.negocio_id;
    const horarioId = req.params.id;

    if (rolUser !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "You do not have permission to edit schedules",
      });
    }

    // Find current schedule block
    const { data: horarioActual, error: horarioError } = await supabase
      .from("horarios")
      .select("*")
      .eq("id", horarioId)
      .eq("negocio_id", negocioId)
      .single();

    if (horarioError || !horarioActual) {
      return res.status(404).json({
        ok: false,
        error: "Schedule not found",
      });
    }

    const {
      dia_semana,
      hora_inicio,
      hora_fin,
      activo,
    } = req.body;

    const diaFinal = dia_semana !== undefined ? dia_semana : horarioActual.dia_semana;
    const inicioFinal = hora_inicio !== undefined ? hora_inicio : horarioActual.hora_inicio;
    const finFinal = hora_fin !== undefined ? hora_fin : horarioActual.hora_fin;
    const activoFinal = activo !== undefined ? activo : horarioActual.activo;

    if (!diasValidos.includes(diaFinal)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid dia_semana value",
      });
    }

    if (inicioFinal >= finFinal) {
      return res.status(400).json({
        ok: false,
        error: "hora_inicio must be earlier than hora_fin",
      });
    }

    // Look for other active blocks on the same day, excluding current record
    const { data: horariosExistentes, error: errorExistentes } = await supabase
      .from("horarios")
      .select("*")
      .eq("negocio_id", negocioId)
      .eq("dia_semana", diaFinal)
      .eq("activo", true)
      .neq("id", horarioId);

    if (errorExistentes) {
      return res.status(500).json({
        ok: false,
        error: errorExistentes.message,
      });
    }

    for (const horario of horariosExistentes || []) {
      if (haySolapamiento(inicioFinal, finFinal, horario.hora_inicio, horario.hora_fin)) {
        return res.status(400).json({
          ok: false,
          error: "The schedule overlaps with an existing block",
        });
      }
    }

    const updateData = {
      dia_semana: diaFinal,
      hora_inicio: inicioFinal,
      hora_fin: finFinal,
      activo: activoFinal,
    };

    const { data, error } = await supabase
      .from("horarios")
      .update(updateData)
      .eq("id", horarioId)
      .eq("negocio_id", negocioId)
      .select("*")
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

/**
 * Create the same time block on multiple days in one request.
 * Body: { dias_semana: ["lun","mar",...], hora_inicio, hora_fin, activo? }
 */
const createHorariosBulkAdmin = async (req, res) => {
  try {
    const rolUser = req.user.rol;
    const negocioId = req.user.negocio_id;

    if (rolUser !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "You do not have permission to create schedules",
      });
    }

    const { dias_semana, hora_inicio, hora_fin, activo = true } = req.body;

    if (!Array.isArray(dias_semana) || dias_semana.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "dias_semana must be a non-empty array of weekday codes",
      });
    }

    if (!hora_inicio || !hora_fin) {
      return res.status(400).json({
        ok: false,
        error: "hora_inicio and hora_fin are required",
      });
    }

    if (hora_inicio >= hora_fin) {
      return res.status(400).json({
        ok: false,
        error: "hora_inicio must be earlier than hora_fin",
      });
    }

    const unique = [...new Set(dias_semana.map((d) => String(d).trim().toLowerCase()))];
    const invalid = unique.filter((d) => !diasValidos.includes(d));
    if (invalid.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Invalid dia_semana value(s)",
      });
    }

    unique.sort((a, b) => ORDEN_DIAS.indexOf(a) - ORDEN_DIAS.indexOf(b));

    const created = [];
    const failed = [];

    for (const dia of unique) {
      const result = await insertHorarioNegocio(negocioId, dia, hora_inicio, hora_fin, activo);
      if (result.ok) {
        created.push(result.data);
      } else {
        failed.push({ dia_semana: dia, error: result.error });
      }
    }

    if (created.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Could not create any schedule block",
        failed,
      });
    }

    return res.status(201).json({
      ok: true,
      created,
      failed: failed.length ? failed : undefined,
      message:
        failed.length > 0
          ? `Created ${created.length} block(s); ${failed.length} day(s) skipped (see failed)`
          : `Created ${created.length} schedule block(s)`,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

const deleteHorarioAdmin = async (req, res) => {
  try {
    const rolUser = req.user.rol;
    const negocioId = req.user.negocio_id;
    const horarioId = req.params.id;

    if (rolUser !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "You do not have permission to delete schedules",
      });
    }

    const { data: horarioActual, error: horarioError } = await supabase
      .from("horarios")
      .select("*")
      .eq("id", horarioId)
      .eq("negocio_id", negocioId)
      .eq("activo", true)
      .single();

    if (horarioError) {
      return res.status(500).json({
        ok: false,
        error: horarioError.message,
      });
    }

    if (!horarioActual) {
      return res.status(404).json({
        ok: false,
        error: "Schedule not found",
      });
    }

    
    const { data, error } = await supabase
    .from("horarios")
    .delete()
    .eq("id", horarioId)
    .eq("negocio_id", negocioId)
    .select("*")
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
  getHorariosAdmin,
  createHorarioAdmin,
  createHorariosBulkAdmin,
  updateHorarioAdmin,
  deleteHorarioAdmin,
  haySolapamiento,
};