const supabase = require("../config/supabase");
const BLOCKING_CONFLICT_STATUSES = ["pendiente_pago", "confirmada"];

async function resolveStaffForNegocio(negocioId, staffId) {
  if (!staffId) return null;
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nombre")
    .eq("id", staffId)
    .eq("negocio_id", negocioId)
    .eq("rol", "staff")
    .eq("activo", true)
    .limit(1);
  if (error) {
    throw new Error(error.message);
  }
  return Array.isArray(data) ? data[0] || null : null;
}

function bloqueoAfectaReserva(bloqueoStaffId, reservaStaffId) {
  if (!bloqueoStaffId) return true;
  return !reservaStaffId || reservaStaffId === bloqueoStaffId;
}

// Admin/Staff: list all blocks for current business
const getBloqueosAdmin = async (req, res) => {
  try {
    const user = req.user;

    if (!["admin", "staff"].includes(user.rol)) {
      return res.status(403).json({
        ok: false,
        error: "Only admin or staff can list blocks",
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

// Admin/Staff: create block
const createBloqueoAdmin = async (req, res) => {
  try {
    const user = req.user;

    if (!["admin", "staff"].includes(user.rol)) {
      return res.status(403).json({
        ok: false,
        error: "Only admin or staff can create blocks",
      });
    }

    const negocioId = user.negocio_id;

    if (!negocioId) {
      return res.status(400).json({
        ok: false,
        error: "User has no business associated",
      });
    }

    const { inicio_en, fin_en, motivo, staff_id } = req.body;

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

    const requestedStaffId = String(staff_id || "").trim() || null;
    let selectedStaff = null;
    if (requestedStaffId) {
      selectedStaff = await resolveStaffForNegocio(negocioId, requestedStaffId);
      if (!selectedStaff) {
        return res.status(400).json({
          ok: false,
          error: "Selected staff is invalid or inactive for this business",
        });
      }
    }

    const { data: overlappingReservas, error: overlapError } = await supabase
      .from("reservas")
      .select("id, inicio_en, fin_en, estado, staff_id")
      .eq("negocio_id", negocioId)
      .in("estado", BLOCKING_CONFLICT_STATUSES)
      .lt("inicio_en", end.toISOString())
      .gt("fin_en", start.toISOString())
      .order("inicio_en", { ascending: true });

    if (overlapError) {
      return res.status(500).json({
        ok: false,
        step: "query overlapping reservas",
        error: overlapError.message,
      });
    }

    const conflicts = (overlappingReservas || []).filter((r) =>
      bloqueoAfectaReserva(selectedStaff?.id || null, r.staff_id || null)
    );

    if (conflicts.length > 0) {
      return res.status(409).json({
        ok: false,
        error:
          "This period already has scheduled reservations. Please reschedule or cancel those reservations before creating the block.",
        conflicts_count: conflicts.length,
        conflicts,
      });
    }

    const insertPayload = {
      negocio_id: negocioId,
      inicio_en: start.toISOString(),
      fin_en: end.toISOString(),
      motivo: motivo || null,
    };
    if (selectedStaff?.id) {
      insertPayload.staff_id = selectedStaff.id;
    }

    const { data, error } = await supabase
      .from("bloqueos")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      const missingStaffColumn =
        selectedStaff?.id &&
        msg.includes("staff_id") &&
        (msg.includes("column") || msg.includes("schema cache"));
      if (missingStaffColumn) {
        return res.status(400).json({
          ok: false,
          error:
            "Your database is missing bloqueos.staff_id. Run the migration to enable staff-specific blocks.",
          code: "MISSING_BLOQUEOS_STAFF_COLUMN",
        });
      }
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

// Admin/Staff: delete block (hard delete is fine here)
const deleteBloqueoAdmin = async (req, res) => {
  try {
    const user = req.user;
    const bloqueoId = req.params.id;

    if (!["admin", "staff"].includes(user.rol)) {
      return res.status(403).json({
        ok: false,
        error: "Only admin or staff can delete blocks",
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

