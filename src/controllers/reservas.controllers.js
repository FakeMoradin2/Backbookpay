const supabase = require("../config/supabase");

const ESTADOS_VALIDOS = [
  "pendiente_pago",
  "confirmada",
  "cancelada",
  "completada",
  "no_show",
  "expirada",
];
const ACTIVE_BOOKING_STATES = ["pendiente_pago", "confirmada"];

/** Upcoming (start >= now) first, soonest first; then past, most recent first. */
function sortReservasNearestFirst(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows || [];
  const now = Date.now();
  return [...rows].sort((a, b) => {
    const aT = new Date(a.inicio_en).getTime();
    const bT = new Date(b.inicio_en).getTime();
    const aFuture = aT >= now;
    const bFuture = bT >= now;
    if (aFuture !== bFuture) return aFuture ? -1 : 1;
    if (aFuture) return aT - bT;
    return bT - aT;
  });
}

const WEEKDAY_MAP = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

// Helper: calcula totales de una lista de servicios (ya enriquecidos)
function calculateTotals(services) {
  let totalPrice = 0;
  let totalDeposit = 0;

  for (const item of services) {
    const qty = Number(item.cantidad ?? 1) || 1;
    const basePrice = Number(item.precio);
    const deposit = Number(item.anticipo_calculado ?? 0);

    if (!Number.isFinite(basePrice) || basePrice < 0) {
      throw new Error("Invalid service price");
    }
    if (!Number.isFinite(deposit) || deposit < 0) {
      throw new Error("Invalid service deposit amount");
    }

    totalPrice += basePrice * qty;
    totalDeposit += deposit * qty;
  }

  if (totalDeposit > totalPrice) {
    throw new Error("Calculated deposit cannot be greater than total price");
  }

  const remaining = totalPrice - totalDeposit;

  return {
    totalPrice,
    totalDeposit,
    remaining,
  };
}

function parseTimeToMinutes(timeString) {
  const [h, m] = String(timeString || "00:00")
    .split(":")
    .map((n) => Number(n));
  return h * 60 + m;
}

function toDateAtMinutes(baseDate, minutes) {
  const d = new Date(baseDate);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes);
  return d;
}

function minutesToTimeLabel(minutes) {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function computeTotalOccupiedMinutes(servicesWithBuffer, defaultBuffer = 0) {
  let total = 0;
  for (const s of servicesWithBuffer) {
    const qty = Number(s.cantidad ?? 1) || 1;
    const duration = Number(s.duracion_min);
    const buffer = Number(s.buffer_min ?? defaultBuffer ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Invalid service duration");
    }
    if (!Number.isFinite(buffer) || buffer < 0) {
      throw new Error("Invalid service buffer");
    }
    total += (duration + buffer) * qty;
  }
  return total;
}

// Helper: calcula anticipo_calculado por servicio según sus reglas
function mapServiceDeposit(servicio, cantidad) {
  const qty = Number(cantidad ?? 1) || 1;
  const price = Number(servicio.precio);

  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Service price must be >= 0");
  }

  let depositPerUnit = 0;

  if (servicio.anticipo_tipo === "fijo") {
    const v = Number(servicio.anticipo_valor);
    if (!Number.isFinite(v) || v <= 0) {
      throw new Error("Invalid fixed deposit configuration");
    }
    depositPerUnit = v;
  } else if (servicio.anticipo_tipo === "porcentaje") {
    const v = Number(servicio.anticipo_valor);
    if (!Number.isFinite(v) || v < 1 || v > 100) {
      throw new Error("Invalid percentage deposit configuration");
    }
    depositPerUnit = (price * v) / 100;
  } else {
    depositPerUnit = 0;
  }

  return {
    cantidad: qty,
    duracion_min: servicio.duracion_min,
    precio: price,
    anticipo_calculado: depositPerUnit,
  };
}

// Helper: verifica solapamiento de reservas con bloqueos y reservas existentes
function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

async function resolveStaffForNegocio(negocioId, staffId, { requireActive = true } = {}) {
  if (!staffId) {
    return {
      ok: false,
      status: 400,
      error: "staff_id is required",
    };
  }

  let query = supabase
    .from("usuarios")
    .select("id, nombre, rol, negocio_id, activo")
    .eq("id", staffId)
    .eq("rol", "staff")
    .eq("negocio_id", negocioId)
    .limit(1);

  if (requireActive) {
    query = query.eq("activo", true);
  }

  const { data, error } = await query;
  if (error) {
    return {
      ok: false,
      status: 500,
      step: "query staff",
      error: error.message,
    };
  }

  const staff = Array.isArray(data) ? data[0] : null;
  if (!staff) {
    return {
      ok: false,
      status: 400,
      error: requireActive
        ? "Selected staff is invalid or inactive for this business"
        : "Selected staff is invalid for this business",
    };
  }

  return { ok: true, staff };
}

async function listActiveStaffIdsForNegocio(negocioId) {
  const { data, error } = await supabase
    .from("usuarios")
    .select("id")
    .eq("negocio_id", negocioId)
    .eq("rol", "staff")
    .eq("activo", true);

  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    ids: Array.isArray(data) ? data.map((x) => x.id) : [],
  };
}

/**
 * Valida que el intervalo [start, end) encaje en horarios, no choque con bloqueos
 * ni con otras reservas (excluyendo excludeReservaId al reagendar).
 */
async function assertSlotAvailable({ negocio_id, staff_id, start, end, excludeReservaId }) {
  const weekday = WEEKDAY_MAP[start.getDay()];
  const { data: horariosDia, error: horariosError } = await supabase
    .from("horarios")
    .select("*")
    .eq("negocio_id", negocio_id)
    .eq("dia_semana", weekday)
    .eq("activo", true);

  if (horariosError) {
    return {
      ok: false,
      status: 500,
      step: "query horarios",
      error: horariosError.message,
    };
  }

  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  let fitsSchedule = false;

  for (const h of horariosDia || []) {
    const blockStart = toDateAtMinutes(dayStart, parseTimeToMinutes(h.hora_inicio));
    const blockEnd = toDateAtMinutes(dayStart, parseTimeToMinutes(h.hora_fin));
    if (start >= blockStart && end <= blockEnd) {
      fitsSchedule = true;
      break;
    }
  }

  if (!fitsSchedule) {
    return {
      ok: false,
      status: 400,
      error: "Selected start time is outside business schedule",
    };
  }

  const { data: bloqueos, error: bloqueosError } = await supabase
    .from("bloqueos")
    .select("*")
    .eq("negocio_id", negocio_id);

  if (bloqueosError) {
    return {
      ok: false,
      status: 500,
      step: "query bloqueos",
      error: bloqueosError.message,
    };
  }

  for (const b of bloqueos || []) {
    const bStart = new Date(b.inicio_en);
    const bEnd = new Date(b.fin_en);
    if (overlaps(start, end, bStart, bEnd)) {
      return {
        ok: false,
        status: 400,
        error: "Requested time is blocked",
      };
    }
  }

  const { data: reservasExistentes, error: reservasError } = await supabase
    .from("reservas")
    .select("id, inicio_en, fin_en, estado, staff_id")
    .eq("negocio_id", negocio_id)
    .neq("estado", "cancelada");

  if (reservasError) {
    return {
      ok: false,
      status: 500,
      step: "query reservas",
      error: reservasError.message,
    };
  }

  for (const r of reservasExistentes || []) {
    if (excludeReservaId && r.id === excludeReservaId) continue;
    const conflictsForStaff =
      !staff_id || !r.staff_id || r.staff_id === staff_id;
    if (!conflictsForStaff) continue;
    const rStart = new Date(r.inicio_en);
    const rEnd = new Date(r.fin_en);
    if (overlaps(start, end, rStart, rEnd)) {
      return {
        ok: false,
        status: 400,
        error: "Requested time overlaps an existing reservation",
      };
    }
  }

  return { ok: true };
}

function hasOverlapForStaff(reservas, targetStaffId, start, end) {
  for (const r of reservas || []) {
    const conflictsForStaff =
      !targetStaffId || !r.staff_id || r.staff_id === targetStaffId;
    if (!conflictsForStaff) continue;
    const rStart = new Date(r.inicio_en);
    const rEnd = new Date(r.fin_en);
    if (overlaps(start, end, rStart, rEnd)) return true;
  }
  return false;
}

function collectDaySlots(
  dayStart,
  horarios,
  bloqueos,
  reservas,
  occupiedMinutes,
  slotStep,
  minStartTime = null
) {
  const slots = [];

  for (const h of horarios) {
    const startMinutes = parseTimeToMinutes(h.hora_inicio);
    const endMinutes = parseTimeToMinutes(h.hora_fin);
    const blockKey = `${h.hora_inicio}-${h.hora_fin}`;

    for (
      let current = startMinutes;
      current + occupiedMinutes <= endMinutes;
      current += slotStep
    ) {
      const slotStart = toDateAtMinutes(dayStart, current);
      const slotEnd = new Date(slotStart.getTime() + occupiedMinutes * 60 * 1000);

      if (minStartTime && slotStart <= minStartTime) {
        continue;
      }

      let blocked = false;

      for (const b of bloqueos || []) {
        if (overlaps(slotStart, slotEnd, new Date(b.inicio_en), new Date(b.fin_en))) {
          blocked = true;
          break;
        }
      }

      if (blocked) continue;

      for (const r of reservas || []) {
        if (overlaps(slotStart, slotEnd, new Date(r.inicio_en), new Date(r.fin_en))) {
          blocked = true;
          break;
        }
      }

      if (blocked) continue;

      slots.push({
        label: minutesToTimeLabel(current),
        start_iso: slotStart.toISOString(),
        end_iso: slotEnd.toISOString(),
        block_key: blockKey,
        block_start: h.hora_inicio,
        block_end: h.hora_fin,
      });
    }
  }

  return slots;
}

// Client: create reservation with one or more services
const createReservaCliente = async (req, res) => {
  try {
    const user = req.user;

    if (user.rol !== "cliente") {
      return res.status(403).json({
        ok: false,
        error: "Only clients can create reservations",
      });
    }

    const {
      negocio_id,
      staff_id,
      servicios, // [{ servicio_id, cantidad }]
      inicio_en,
      nota,
    } = req.body;

    if (!negocio_id || !Array.isArray(servicios) || servicios.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "negocio_id and at least one service are required",
      });
    }

    if (!inicio_en) {
      return res.status(400).json({
        ok: false,
        error: "Start datetime is required",
      });
    }

    const start = new Date(inicio_en);

    if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
      return res.status(400).json({
        ok: false,
        error: "Invalid start datetime",
      });
    }

    if (start <= new Date()) {
      return res.status(400).json({
        ok: false,
        error: "Start datetime must be in the future",
      });
    }

    // 1) Verify negocio exists and is active
    const { data: negocio, error: negocioError } = await supabase
      .from("negocios")
      .select(
        "id, activo, duracion_buffer_min, stripe_connect_account_id, stripe_connect_charges_enabled"
      )
      .eq("id", negocio_id)
      .eq("activo", true)
      .single();

    if (negocioError || !negocio) {
      return res.status(404).json({
        ok: false,
        error: "Business not found or inactive",
      });
    }

    const activeStaffResult = await listActiveStaffIdsForNegocio(negocio_id);
    if (!activeStaffResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "query active staff",
        error: activeStaffResult.error,
      });
    }
    const activeStaffIds = activeStaffResult.ids;
    let selectedStaffId = null;
    const requestedStaffId = String(staff_id || "").trim() || null;
    if (activeStaffIds.length > 0) {
      if (requestedStaffId) {
        const staffCheck = await resolveStaffForNegocio(negocio_id, requestedStaffId, {
          requireActive: true,
        });
        if (!staffCheck.ok) {
          return res.status(staffCheck.status || 400).json({
            ok: false,
            error: staffCheck.error,
            step: staffCheck.step,
          });
        }
        selectedStaffId = requestedStaffId;
      }
    }

    // 2) Load services and validate they belong to negocio and are active
    const serviceIds = servicios.map((s) => s.servicio_id);

    const { data: serviciosDb, error: serviciosError } = await supabase
      .from("servicios")
      .select("*")
      .in("id", serviceIds)
      .eq("negocio_id", negocio_id)
      .eq("activo", true);

    if (serviciosError) {
      return res.status(500).json({
        ok: false,
        step: "query servicios",
        error: serviciosError.message,
      });
    }

    if (!serviciosDb || serviciosDb.length !== serviceIds.length) {
      return res.status(400).json({
        ok: false,
        error: "Some services are invalid or inactive for this business",
      });
    }

    // 3) Compute effective occupied duration and end datetime
    const selectedServiceRows = servicios.map((s) => {
      const row = serviciosDb.find((x) => x.id === s.servicio_id);
      return {
        ...row,
        cantidad: s.cantidad ?? 1,
      };
    });

    const totalOccupiedMinutes = computeTotalOccupiedMinutes(
      selectedServiceRows,
      Number(negocio.duracion_buffer_min || 0)
    );
    const end = new Date(start.getTime() + totalOccupiedMinutes * 60 * 1000);

    // 4) Validate chosen slot is inside a business schedule block for that weekday
    const weekday = WEEKDAY_MAP[start.getDay()];
    const { data: horariosDia, error: horariosError } = await supabase
      .from("horarios")
      .select("*")
      .eq("negocio_id", negocio_id)
      .eq("dia_semana", weekday)
      .eq("activo", true);

    if (horariosError) {
      return res.status(500).json({
        ok: false,
        step: "query horarios",
        error: horariosError.message,
      });
    }

    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    let fitsSchedule = false;

    for (const h of horariosDia || []) {
      const blockStart = toDateAtMinutes(dayStart, parseTimeToMinutes(h.hora_inicio));
      const blockEnd = toDateAtMinutes(dayStart, parseTimeToMinutes(h.hora_fin));
      if (start >= blockStart && end <= blockEnd) {
        fitsSchedule = true;
        break;
      }
    }

    if (!fitsSchedule) {
      return res.status(400).json({
        ok: false,
        error: "Selected start time is outside business schedule",
      });
    }

    const { data: bloqueos, error: bloqueosError } = await supabase
      .from("bloqueos")
      .select("*")
      .eq("negocio_id", negocio_id);

    if (bloqueosError) {
      return res.status(500).json({
        ok: false,
        step: "query bloqueos",
        error: bloqueosError.message,
      });
    }

    for (const b of bloqueos || []) {
      const bStart = new Date(b.inicio_en);
      const bEnd = new Date(b.fin_en);
      if (overlaps(start, end, bStart, bEnd)) {
        return res.status(400).json({
          ok: false,
          error: "Requested time is blocked",
        });
      }
    }

    const { data: reservasExistentes, error: reservasError } = await supabase
      .from("reservas")
      .select("id, inicio_en, fin_en, estado, staff_id")
      .eq("negocio_id", negocio_id)
      .neq("estado", "cancelada");

    if (reservasError) {
      return res.status(500).json({
        ok: false,
        step: "query reservas",
        error: reservasError.message,
      });
    }

    if (!selectedStaffId && activeStaffIds.length > 0) {
      const firstFreeStaff = activeStaffIds.find(
        (candidateStaffId) => !hasOverlapForStaff(reservasExistentes || [], candidateStaffId, start, end)
      );
      if (!firstFreeStaff) {
        return res.status(400).json({
          ok: false,
          error: "No staff member is available at that time. Please choose another slot.",
        });
      }
      selectedStaffId = firstFreeStaff;
    } else if (hasOverlapForStaff(reservasExistentes || [], selectedStaffId, start, end)) {
      return res.status(400).json({
        ok: false,
        error: "Requested time overlaps an existing reservation",
      });
    }

    // 5) Map services and calculate totals
    const detailedServices = servicios.map((s) => {
      const servicioDb = serviciosDb.find((x) => x.id === s.servicio_id);
      const base = mapServiceDeposit(servicioDb, s.cantidad);
      return {
        ...base,
        servicio_id: s.servicio_id,
      };
    });

    const { totalPrice, totalDeposit, remaining } = calculateTotals(detailedServices);

    // 6) Insert reservation + details in a single transaction-like flow.
    // Supabase JS client does not support DB transactions directly,
    // but constraints keep data consistent enough for v1.

    const { data: reserva, error: reservaError } = await supabase
      .from("reservas")
      .insert({
        negocio_id,
        staff_id: selectedStaffId,
        usuario_id: user.id,
        inicio_en: start.toISOString(),
        fin_en: end.toISOString(),
        estado: totalDeposit > 0 ? "pendiente_pago" : "confirmada",
        precio_total: totalPrice,
        anticipo_calculado: totalDeposit,
        saldo_pendiente: remaining,
        nota: nota || null,
      })
      .select("*")
      .single();

    if (reservaError) {
      return res.status(500).json({
        ok: false,
        step: "insert reserva",
        error: reservaError.message,
      });
    }

    const detallesPayload = detailedServices.map((ds) => ({
      reserva_id: reserva.id,
      servicio_id: ds.servicio_id,
      cantidad: ds.cantidad,
      duracion_min: ds.duracion_min,
      precio: ds.precio,
      anticipo_calculado: ds.anticipo_calculado * ds.cantidad,
    }));

    const { error: detallesError } = await supabase
      .from("reserva_servicios")
      .insert(detallesPayload);

    if (detallesError) {
      return res.status(500).json({
        ok: false,
        step: "insert reserva_servicios",
        error: detallesError.message,
      });
    }

    const canPayDepositOnline =
      totalDeposit > 0 &&
      !!negocio.stripe_connect_account_id &&
      !!negocio.stripe_connect_charges_enabled;

    return res.status(201).json({
      ok: true,
      data: {
        reserva,
        servicios: detallesPayload,
        computed_end: end.toISOString(),
        occupied_minutes: totalOccupiedMinutes,
        deposit_amount: totalDeposit,
        can_pay_deposit_online: canPayDepositOnline,
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

// Admin/Staff: create reservation manually (registered or guest client)
const createReservaAdmin = async (req, res) => {
  try {
    const user = req.user;

    if (!["admin", "staff"].includes(user.rol)) {
      return res.status(403).json({
        ok: false,
        error: "Only admin or staff can create manual reservations",
      });
    }

    const negocioId = user.negocio_id;
    if (!negocioId) {
      return res.status(400).json({
        ok: false,
        error: "User has no business associated",
      });
    }

    const {
      cliente_id,
      cliente_correo,
      cliente_nombre,
      cliente_telefono,
      staff_id,
      servicios, // [{ servicio_id, cantidad }]
      inicio_en,
      nota,
      estado,
    } = req.body;

    if (!Array.isArray(servicios) || servicios.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "At least one service is required",
      });
    }

    if (!inicio_en) {
      return res.status(400).json({
        ok: false,
        error: "Start datetime is required",
      });
    }

    const start = new Date(inicio_en);
    if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
      return res.status(400).json({
        ok: false,
        error: "Invalid start datetime",
      });
    }

    if (start <= new Date()) {
      return res.status(400).json({
        ok: false,
        error: "Start datetime must be in the future",
      });
    }

    const manualName = String(cliente_nombre || "").trim();
    const manualEmail = String(cliente_correo || "")
      .trim()
      .toLowerCase();
    const manualPhone = String(cliente_telefono || "").trim();

    let client = null;
    if (cliente_id || manualEmail) {
      let clientQuery = supabase
        .from("usuarios")
        .select("id, nombre, correo, rol, activo")
        .eq("rol", "cliente")
        .eq("activo", true)
        .limit(1);

      if (cliente_id) {
        clientQuery = clientQuery.eq("id", cliente_id);
      } else {
        clientQuery = clientQuery.eq("correo", manualEmail);
      }

      const { data: clientRows, error: clientError } = await clientQuery;
      if (clientError) {
        return res.status(500).json({
          ok: false,
          step: "query client",
          error: clientError.message,
        });
      }
      client = Array.isArray(clientRows) ? clientRows[0] : null;
    }

    if (!client && !manualName) {
      return res.status(400).json({
        ok: false,
        error: "cliente_nombre is required when client is not registered",
      });
    }

    const { data: negocio, error: negocioError } = await supabase
      .from("negocios")
      .select("id, activo, duracion_buffer_min")
      .eq("id", negocioId)
      .eq("activo", true)
      .single();

    if (negocioError || !negocio) {
      return res.status(404).json({
        ok: false,
        error: "Business not found or inactive",
      });
    }

    const activeStaffResult = await listActiveStaffIdsForNegocio(negocioId);
    if (!activeStaffResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "query active staff",
        error: activeStaffResult.error,
      });
    }
    const activeStaffIds = activeStaffResult.ids;
    let selectedStaffId = null;
    const requestedStaffId = String(staff_id || "").trim() || null;
    if (activeStaffIds.length > 0) {
      if (user.rol === "staff") {
        selectedStaffId = user.id;
      } else if (requestedStaffId) {
        const staffCheck = await resolveStaffForNegocio(negocioId, requestedStaffId, {
          requireActive: true,
        });
        if (!staffCheck.ok) {
          return res.status(staffCheck.status || 400).json({
            ok: false,
            error: staffCheck.error,
            step: staffCheck.step,
          });
        }
        selectedStaffId = requestedStaffId;
      }
    }

    const serviceIds = servicios.map((s) => s.servicio_id);
    const { data: serviciosDb, error: serviciosError } = await supabase
      .from("servicios")
      .select("*")
      .in("id", serviceIds)
      .eq("negocio_id", negocioId)
      .eq("activo", true);

    if (serviciosError) {
      return res.status(500).json({
        ok: false,
        step: "query servicios",
        error: serviciosError.message,
      });
    }

    if (!serviciosDb || serviciosDb.length !== serviceIds.length) {
      return res.status(400).json({
        ok: false,
        error: "Some services are invalid or inactive for this business",
      });
    }

    const selectedServiceRows = servicios.map((s) => {
      const row = serviciosDb.find((x) => x.id === s.servicio_id);
      return {
        ...row,
        cantidad: s.cantidad ?? 1,
      };
    });

    const totalOccupiedMinutes = computeTotalOccupiedMinutes(
      selectedServiceRows,
      Number(negocio.duracion_buffer_min || 0)
    );
    const end = new Date(start.getTime() + totalOccupiedMinutes * 60 * 1000);

    const weekday = WEEKDAY_MAP[start.getDay()];
    const { data: horariosDia, error: horariosError } = await supabase
      .from("horarios")
      .select("*")
      .eq("negocio_id", negocioId)
      .eq("dia_semana", weekday)
      .eq("activo", true);

    if (horariosError) {
      return res.status(500).json({
        ok: false,
        step: "query horarios",
        error: horariosError.message,
      });
    }

    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    let fitsSchedule = false;

    for (const h of horariosDia || []) {
      const blockStart = toDateAtMinutes(dayStart, parseTimeToMinutes(h.hora_inicio));
      const blockEnd = toDateAtMinutes(dayStart, parseTimeToMinutes(h.hora_fin));
      if (start >= blockStart && end <= blockEnd) {
        fitsSchedule = true;
        break;
      }
    }

    if (!fitsSchedule) {
      return res.status(400).json({
        ok: false,
        error: "Selected start time is outside business schedule",
      });
    }

    const { data: bloqueos, error: bloqueosError } = await supabase
      .from("bloqueos")
      .select("*")
      .eq("negocio_id", negocioId);

    if (bloqueosError) {
      return res.status(500).json({
        ok: false,
        step: "query bloqueos",
        error: bloqueosError.message,
      });
    }

    for (const b of bloqueos || []) {
      const bStart = new Date(b.inicio_en);
      const bEnd = new Date(b.fin_en);
      if (overlaps(start, end, bStart, bEnd)) {
        return res.status(400).json({
          ok: false,
          error: "Requested time is blocked",
        });
      }
    }

    const { data: reservasExistentes, error: reservasError } = await supabase
      .from("reservas")
      .select("id, inicio_en, fin_en, estado, staff_id")
      .eq("negocio_id", negocioId)
      .neq("estado", "cancelada");

    if (reservasError) {
      return res.status(500).json({
        ok: false,
        step: "query reservas",
        error: reservasError.message,
      });
    }

    if (!selectedStaffId && activeStaffIds.length > 0) {
      const firstFreeStaff = activeStaffIds.find(
        (candidateStaffId) => !hasOverlapForStaff(reservasExistentes || [], candidateStaffId, start, end)
      );
      if (!firstFreeStaff) {
        return res.status(400).json({
          ok: false,
          error: "No staff member is available at that time. Please choose another slot.",
        });
      }
      selectedStaffId = firstFreeStaff;
    } else if (hasOverlapForStaff(reservasExistentes || [], selectedStaffId, start, end)) {
      return res.status(400).json({
        ok: false,
        error: "Requested time overlaps an existing reservation",
      });
    }

    const detailedServices = servicios.map((s) => {
      const servicioDb = serviciosDb.find((x) => x.id === s.servicio_id);
      const base = mapServiceDeposit(servicioDb, s.cantidad);
      return {
        ...base,
        servicio_id: s.servicio_id,
      };
    });

    const { totalPrice, totalDeposit, remaining } = calculateTotals(detailedServices);

    let initialStatus = totalDeposit > 0 ? "pendiente_pago" : "confirmada";
    if (estado !== undefined && estado !== null) {
      if (!ESTADOS_VALIDOS.includes(estado)) {
        return res.status(400).json({
          ok: false,
          error: "Invalid reservation status",
        });
      }
      initialStatus = estado;
    }

    const { data: reserva, error: reservaError } = await supabase
      .from("reservas")
      .insert({
        negocio_id: negocioId,
        staff_id: selectedStaffId,
        usuario_id: client?.id || null,
        inicio_en: start.toISOString(),
        fin_en: end.toISOString(),
        estado: initialStatus,
        precio_total: totalPrice,
        anticipo_calculado: totalDeposit,
        saldo_pendiente: remaining,
        cliente_manual_nombre: client ? null : manualName,
        cliente_manual_correo: client ? null : manualEmail || null,
        cliente_manual_telefono: client ? null : manualPhone || null,
        nota: nota || null,
      })
      .select("*")
      .single();

    if (reservaError) {
      return res.status(500).json({
        ok: false,
        step: "insert reserva",
        error: reservaError.message,
      });
    }

    const detallesPayload = detailedServices.map((ds) => ({
      reserva_id: reserva.id,
      servicio_id: ds.servicio_id,
      cantidad: ds.cantidad,
      duracion_min: ds.duracion_min,
      precio: ds.precio,
      anticipo_calculado: ds.anticipo_calculado * ds.cantidad,
    }));

    const { error: detallesError } = await supabase
      .from("reserva_servicios")
      .insert(detallesPayload);

    if (detallesError) {
      return res.status(500).json({
        ok: false,
        step: "insert reserva_servicios",
        error: detallesError.message,
      });
    }

    return res.status(201).json({
      ok: true,
      data: {
        reserva,
        client: client
          ? {
              id: client.id,
              nombre: client.nombre,
              correo: client.correo,
            }
          : {
              id: null,
              nombre: manualName,
              correo: manualEmail || null,
              telefono: manualPhone || null,
              guest: true,
            },
        servicios: detallesPayload,
        computed_end: end.toISOString(),
        occupied_minutes: totalOccupiedMinutes,
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

// Public/client: get available start times for a business date and selected services
const getDisponibilidadPublic = async (req, res) => {
  try {
    const { negocio_id, fecha, servicio_ids, staff_id } = req.query;
    const slotStep = Number(req.query.step_min || 15);

    if (!negocio_id || !fecha || !servicio_ids) {
      return res.status(400).json({
        ok: false,
        error: "negocio_id, fecha and servicio_ids are required",
      });
    }

    const ids = String(servicio_ids)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "At least one service id is required",
      });
    }

    const date = new Date(`${fecha}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({
        ok: false,
        error: "Invalid fecha value. Use YYYY-MM-DD format",
      });
    }

    const weekday = WEEKDAY_MAP[date.getDay()];

    const { data: negocio, error: negocioError } = await supabase
      .from("negocios")
      .select("id, activo, duracion_buffer_min")
      .eq("id", negocio_id)
      .eq("activo", true)
      .single();

    if (negocioError || !negocio) {
      return res.status(404).json({
        ok: false,
        error: "Business not found or inactive",
      });
    }

    const selectedStaffId = String(staff_id || "").trim() || null;
    const activeStaffResult = await listActiveStaffIdsForNegocio(negocio_id);
    if (!activeStaffResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "query active staff",
        error: activeStaffResult.error,
      });
    }
    const activeStaffIds = activeStaffResult.ids;
    if (selectedStaffId) {
      const staffCheck = await resolveStaffForNegocio(negocio_id, selectedStaffId, {
        requireActive: true,
      });
      if (!staffCheck.ok) {
        return res.status(staffCheck.status || 400).json({
          ok: false,
          error: staffCheck.error,
          step: staffCheck.step,
        });
      }
    }

    const { data: servicios, error: serviciosError } = await supabase
      .from("servicios")
      .select("*")
      .in("id", ids)
      .eq("negocio_id", negocio_id)
      .eq("activo", true);

    if (serviciosError) {
      return res.status(500).json({
        ok: false,
        step: "query servicios",
        error: serviciosError.message,
      });
    }

    if (!servicios || servicios.length !== ids.length) {
      return res.status(400).json({
        ok: false,
        error: "Some services are invalid or inactive for this business",
      });
    }

    const occupiedMinutes = computeTotalOccupiedMinutes(
      servicios.map((s) => ({ ...s, cantidad: 1 })),
      Number(negocio.duracion_buffer_min || 0)
    );

    const { data: horarios, error: horariosError } = await supabase
      .from("horarios")
      .select("*")
      .eq("negocio_id", negocio_id)
      .eq("dia_semana", weekday)
      .eq("activo", true);

    if (horariosError) {
      return res.status(500).json({
        ok: false,
        step: "query horarios",
        error: horariosError.message,
      });
    }

    if (!horarios || horarios.length === 0) {
      return res.json({
        ok: true,
        data: {
          slots: [],
          occupied_minutes: occupiedMinutes,
        },
      });
    }

    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const { data: bloqueos, error: bloqueosError } = await supabase
      .from("bloqueos")
      .select("*")
      .eq("negocio_id", negocio_id);

    if (bloqueosError) {
      return res.status(500).json({
        ok: false,
        step: "query bloqueos",
        error: bloqueosError.message,
      });
    }

    const { data: reservas, error: reservasError } = await supabase
      .from("reservas")
      .select("id, inicio_en, fin_en, estado, staff_id")
      .eq("negocio_id", negocio_id)
      .neq("estado", "cancelada")
      .gt("fin_en", dayStart.toISOString())
      .lt("inicio_en", dayEnd.toISOString());

    if (reservasError) {
      return res.status(500).json({
        ok: false,
        step: "query reservas",
        error: reservasError.message,
      });
    }

    const now = new Date();
    const isToday = now.toDateString() === dayStart.toDateString();

    let slots = [];
    if (selectedStaffId || activeStaffIds.length === 0) {
      slots = collectDaySlots(
        dayStart,
        horarios,
        bloqueos || [],
        (reservas || []).filter((r) => {
          if (!selectedStaffId) return true;
          return !r.staff_id || r.staff_id === selectedStaffId;
        }),
        occupiedMinutes,
        slotStep,
        isToday ? now : null
      );
    } else {
      const byStart = new Map();
      for (const candidateStaffId of activeStaffIds) {
        const candidateSlots = collectDaySlots(
          dayStart,
          horarios,
          bloqueos || [],
          (reservas || []).filter(
            (r) => !r.staff_id || r.staff_id === candidateStaffId
          ),
          occupiedMinutes,
          slotStep,
          isToday ? now : null
        );
        for (const slot of candidateSlots) {
          if (!byStart.has(slot.start_iso)) {
            byStart.set(slot.start_iso, slot);
          }
        }
      }
      slots = Array.from(byStart.values()).sort((a, b) =>
        a.start_iso < b.start_iso ? -1 : 1
      );
    }

    return res.json({
      ok: true,
      data: {
        slots,
        occupied_minutes: occupiedMinutes,
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

const getFechasDisponiblesPublic = async (req, res) => {
  try {
    const { negocio_id, servicio_ids, staff_id } = req.query;
    const slotStep = Number(req.query.step_min || 15);
    const parsedDaysWindow = Number.parseInt(String(req.query.days || "30"), 10);
    const daysWindow = Number.isNaN(parsedDaysWindow)
      ? 30
      : Math.min(365, Math.max(1, parsedDaysWindow));

    if (!negocio_id || !servicio_ids) {
      return res.status(400).json({
        ok: false,
        error: "negocio_id and servicio_ids are required",
      });
    }

    const ids = String(servicio_ids)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "At least one service id is required",
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endRange = new Date(today.getTime() + daysWindow * 24 * 60 * 60 * 1000);

    const { data: negocio, error: negocioError } = await supabase
      .from("negocios")
      .select("id, activo, duracion_buffer_min")
      .eq("id", negocio_id)
      .eq("activo", true)
      .single();

    if (negocioError || !negocio) {
      return res.status(404).json({
        ok: false,
        error: "Business not found or inactive",
      });
    }

    const selectedStaffId = String(staff_id || "").trim() || null;
    const activeStaffResult = await listActiveStaffIdsForNegocio(negocio_id);
    if (!activeStaffResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "query active staff",
        error: activeStaffResult.error,
      });
    }
    const activeStaffIds = activeStaffResult.ids;
    if (selectedStaffId) {
      const staffCheck = await resolveStaffForNegocio(negocio_id, selectedStaffId, {
        requireActive: true,
      });
      if (!staffCheck.ok) {
        return res.status(staffCheck.status || 400).json({
          ok: false,
          error: staffCheck.error,
          step: staffCheck.step,
        });
      }
    }

    const { data: servicios, error: serviciosError } = await supabase
      .from("servicios")
      .select("*")
      .in("id", ids)
      .eq("negocio_id", negocio_id)
      .eq("activo", true);

    if (serviciosError) {
      return res.status(500).json({
        ok: false,
        step: "query servicios",
        error: serviciosError.message,
      });
    }

    if (!servicios || servicios.length !== ids.length) {
      return res.status(400).json({
        ok: false,
        error: "Some services are invalid or inactive for this business",
      });
    }

    const occupiedMinutes = computeTotalOccupiedMinutes(
      servicios.map((s) => ({ ...s, cantidad: 1 })),
      Number(negocio.duracion_buffer_min || 0)
    );

    const { data: horarios, error: horariosError } = await supabase
      .from("horarios")
      .select("*")
      .eq("negocio_id", negocio_id)
      .eq("activo", true);

    if (horariosError) {
      return res.status(500).json({
        ok: false,
        step: "query horarios",
        error: horariosError.message,
      });
    }

    const { data: bloqueos, error: bloqueosError } = await supabase
      .from("bloqueos")
      .select("*")
      .eq("negocio_id", negocio_id);

    if (bloqueosError) {
      return res.status(500).json({
        ok: false,
        step: "query bloqueos",
        error: bloqueosError.message,
      });
    }

    const { data: reservas, error: reservasError } = await supabase
      .from("reservas")
      .select("id, inicio_en, fin_en, estado, staff_id")
      .eq("negocio_id", negocio_id)
      .neq("estado", "cancelada")
      .gt("fin_en", today.toISOString())
      .lt("inicio_en", endRange.toISOString());

    if (reservasError) {
      return res.status(500).json({
        ok: false,
        step: "query reservas",
        error: reservasError.message,
      });
    }

    const dates = [];

    for (let i = 0; i <= daysWindow; i += 1) {
      const date = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
      const weekday = WEEKDAY_MAP[date.getDay()];
      const daySchedules = (horarios || []).filter((h) => h.dia_semana === weekday);
      if (daySchedules.length === 0) continue;

      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const nextDay = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      const dayReservas = (reservas || []).filter((r) => {
        if (selectedStaffId && r.staff_id && r.staff_id !== selectedStaffId) return false;
        const rStart = new Date(r.inicio_en);
        return rStart >= dayStart && rStart < nextDay;
      });

      const now = new Date();
      const isToday = now.toDateString() === dayStart.toDateString();

      let slots = [];
      if (selectedStaffId || activeStaffIds.length === 0) {
        slots = collectDaySlots(
          dayStart,
          daySchedules,
          bloqueos || [],
          dayReservas,
          occupiedMinutes,
          slotStep,
          isToday ? now : null
        );
      } else {
        const byStart = new Map();
        for (const candidateStaffId of activeStaffIds) {
          const candidateDayReservas = (reservas || []).filter((r) => {
            if (r.staff_id && r.staff_id !== candidateStaffId) return false;
            const rStart = new Date(r.inicio_en);
            return rStart >= dayStart && rStart < nextDay;
          });
          const candidateSlots = collectDaySlots(
            dayStart,
            daySchedules,
            bloqueos || [],
            candidateDayReservas,
            occupiedMinutes,
            slotStep,
            isToday ? now : null
          );
          for (const slot of candidateSlots) {
            if (!byStart.has(slot.start_iso)) {
              byStart.set(slot.start_iso, slot);
            }
          }
        }
        slots = Array.from(byStart.values());
      }

      if (slots.length > 0) {
        const isoDate = dayStart.toISOString().slice(0, 10);
        dates.push({
          date: isoDate,
          weekday,
          slots_count: slots.length,
        });
      }
    }

    return res.json({
      ok: true,
      data: {
        dates,
        occupied_minutes: occupiedMinutes,
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

// Client: list own reservations
const getReservasCliente = async (req, res) => {
  try {
    const user = req.user;

    if (user.rol !== "cliente") {
      return res.status(403).json({
        ok: false,
        error: "Only clients can list their reservations",
      });
    }

    const { data, error } = await supabase
      .from("reservas")
      .select("*, reserva_servicios(*), negocios(nombre)")
      .eq("usuario_id", user.id)
      .neq("estado", "cancelada");

    if (error) {
      return res.status(500).json({
        ok: false,
        step: "query reservas",
        error: error.message,
      });
    }

    const sorted = sortReservasNearestFirst(data || []);

    return res.json({
      ok: true,
      data: sorted,
      count: sorted.length,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

// Admin/Staff: list reservations of their business (with optional filters)
const getReservasNegocio = async (req, res) => {
  try {
    const user = req.user;

    if (!["admin", "staff"].includes(user.rol)) {
      return res.status(403).json({
        ok: false,
        error: "Only admin or staff can list business reservations",
      });
    }

    const negocioId = user.negocio_id;
    if (!negocioId) {
      return res.status(400).json({
        ok: false,
        error: "User has no business associated",
      });
    }

    const { from, to, status } = req.query;

    let query = supabase
      .from("reservas")
      .select("*")
      .eq("negocio_id", negocioId);

    if (from) {
      query = query.gte("inicio_en", from);
    }
    if (to) {
      query = query.lte("inicio_en", to);
    }
    if (status && ESTADOS_VALIDOS.includes(status)) {
      query = query.eq("estado", status);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        ok: false,
        step: "query reservas negocio",
        error: error.message,
      });
    }

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return res.json({
        ok: true,
        data: [],
        count: 0,
      });
    }

    const reservaIds = rows.map((r) => r.id);
    const userIds = Array.from(
      new Set(
        rows
          .flatMap((r) => [r.usuario_id, r.staff_id])
          .filter((id) => typeof id === "string" && id.trim().length > 0)
      )
    );

    let usersById = {};
    if (userIds.length > 0) {
      const { data: usersData, error: usersError } = await supabase
        .from("usuarios")
        .select("id, nombre, correo, telefono, rol")
        .in("id", userIds);

      if (usersError) {
        return res.status(500).json({
          ok: false,
          step: "query usuarios for reservas negocio",
          error: usersError.message,
        });
      }

      usersById = Object.fromEntries((usersData || []).map((u) => [u.id, u]));
    }

    const { data: detallesData, error: detallesError } = await supabase
      .from("reserva_servicios")
      .select("*")
      .in("reserva_id", reservaIds);

    if (detallesError) {
      return res.status(500).json({
        ok: false,
        step: "query reserva_servicios for reservas negocio",
        error: detallesError.message,
      });
    }

    const { data: pagosData, error: pagosError } = await supabase
      .from("pagos")
      .select("*")
      .in("reserva_id", reservaIds);

    if (pagosError) {
      return res.status(500).json({
        ok: false,
        step: "query pagos for reservas negocio",
        error: pagosError.message,
      });
    }

    const detallesByReserva = {};
    for (const d of detallesData || []) {
      if (!detallesByReserva[d.reserva_id]) detallesByReserva[d.reserva_id] = [];
      detallesByReserva[d.reserva_id].push(d);
    }

    const pagosByReserva = {};
    for (const p of pagosData || []) {
      if (!pagosByReserva[p.reserva_id]) pagosByReserva[p.reserva_id] = [];
      pagosByReserva[p.reserva_id].push(p);
    }

    const hydrated = rows.map((r) => ({
      ...r,
      usuarios: r.usuario_id ? usersById[r.usuario_id] || null : null,
      staff: r.staff_id ? usersById[r.staff_id] || null : null,
      reserva_servicios: detallesByReserva[r.id] || [],
      pagos: pagosByReserva[r.id] || [],
    }));

    const sorted = sortReservasNearestFirst(hydrated);

    return res.json({
      ok: true,
      data: sorted,
      count: sorted.length,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

// Admin/Staff: update reservation status
const updateReservaEstado = async (req, res) => {
  try {
    const user = req.user;
    const reservaId = req.params.id;
    const { estado } = req.body;

    if (!["admin", "staff"].includes(user.rol)) {
      return res.status(403).json({
        ok: false,
        error: "Only admin or staff can update reservation status",
      });
    }

    if (!ESTADOS_VALIDOS.includes(estado)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid reservation status",
      });
    }

    const negocioId = user.negocio_id;
    if (!negocioId) {
      return res.status(400).json({
        ok: false,
        error: "User has no business associated",
      });
    }

    const { data: reservaActual, error: reservaError } = await supabase
      .from("reservas")
      .select("*")
      .eq("id", reservaId)
      .eq("negocio_id", negocioId)
      .single();

    if (reservaError || !reservaActual) {
      return res.status(404).json({
        ok: false,
        error: "Reservation not found for this business",
      });
    }

    const { data, error } = await supabase
      .from("reservas")
      .update({ estado })
      .eq("id", reservaId)
      .eq("negocio_id", negocioId)
      .select("*")
      .single();

    if (error) {
      return res.status(500).json({
        ok: false,
        step: "update reserva estado",
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

// Client: cancel own reservation (basic rule: only if not completed and not already cancelled)
const cancelReservaCliente = async (req, res) => {
  try {
    const user = req.user;
    const reservaId = req.params.id;

    if (user.rol !== "cliente") {
      return res.status(403).json({
        ok: false,
        error: "Only clients can cancel their reservations",
      });
    }

    const { data: reserva, error: reservaError } = await supabase
      .from("reservas")
      .select("*")
      .eq("id", reservaId)
      .eq("usuario_id", user.id)
      .single();

    if (reservaError || !reserva) {
      return res.status(404).json({
        ok: false,
        error: "Reservation not found",
      });
    }

    if (["completada", "cancelada", "expirada"].includes(reserva.estado)) {
      return res.status(400).json({
        ok: false,
        error: "Reservation cannot be cancelled in its current status",
      });
    }

    const { error: delDetErr } = await supabase
      .from("reserva_servicios")
      .delete()
      .eq("reserva_id", reservaId);

    if (delDetErr) {
      return res.status(500).json({
        ok: false,
        step: "delete reserva_servicios cancel",
        error: delDetErr.message,
      });
    }

    const { error: delPagosErr } = await supabase.from("pagos").delete().eq("reserva_id", reservaId);

    if (delPagosErr) {
      return res.status(500).json({
        ok: false,
        step: "delete pagos cancel",
        error: delPagosErr.message,
      });
    }

    const { error: delResErr } = await supabase
      .from("reservas")
      .delete()
      .eq("id", reservaId)
      .eq("usuario_id", user.id);

    if (delResErr) {
      return res.status(500).json({
        ok: false,
        step: "delete reserva cancel",
        error: delResErr.message,
      });
    }

    return res.json({
      ok: true,
      deleted: true,
      id: reservaId,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
};

const RESCHEDULE_ALLOWED_ESTADOS = ["pendiente_pago", "confirmada"];

async function loadReservaServiceRowsForDuration(reservaId, negocioId) {
  const { data: detalles, error: detErr } = await supabase
    .from("reserva_servicios")
    .select("servicio_id, cantidad")
    .eq("reserva_id", reservaId);

  if (detErr) {
    return { error: detErr.message };
  }
  if (!detalles || detalles.length === 0) {
    return { error: "Reservation has no services" };
  }

  const servicioIds = [...new Set(detalles.map((d) => d.servicio_id))];
  const { data: serviciosDb, error: servErr } = await supabase
    .from("servicios")
    .select("*")
    .in("id", servicioIds)
    .eq("negocio_id", negocioId)
    .eq("activo", true);

  if (servErr) {
    return { error: servErr.message };
  }
  if (!serviciosDb || serviciosDb.length !== servicioIds.length) {
    return { error: "Could not load services for this reservation" };
  }

  const selectedServiceRows = detalles.map((d) => {
    const row = serviciosDb.find((x) => x.id === d.servicio_id);
    return {
      ...row,
      cantidad: d.cantidad ?? 1,
    };
  });

  return { selectedServiceRows };
}

const reagendarReservaCliente = async (req, res) => {
  try {
    const user = req.user;
    const reservaId = req.params.id;
    const { inicio_en } = req.body;

    if (user.rol !== "cliente") {
      return res.status(403).json({
        ok: false,
        error: "Only clients can reschedule their reservations",
      });
    }

    if (!inicio_en) {
      return res.status(400).json({
        ok: false,
        error: "Start datetime is required",
      });
    }

    const start = new Date(inicio_en);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({
        ok: false,
        error: "Invalid start datetime",
      });
    }

    if (start <= new Date()) {
      return res.status(400).json({
        ok: false,
        error: "Start datetime must be in the future",
      });
    }

    const { data: reserva, error: reservaError } = await supabase
      .from("reservas")
      .select("*")
      .eq("id", reservaId)
      .eq("usuario_id", user.id)
      .single();

    if (reservaError || !reserva) {
      return res.status(404).json({
        ok: false,
        error: "Reservation not found",
      });
    }

    if (!RESCHEDULE_ALLOWED_ESTADOS.includes(reserva.estado)) {
      return res.status(400).json({
        ok: false,
        error: "Reservation cannot be rescheduled in its current status",
      });
    }

    const { data: negocio, error: negocioError } = await supabase
      .from("negocios")
      .select("id, activo, duracion_buffer_min")
      .eq("id", reserva.negocio_id)
      .eq("activo", true)
      .single();

    if (negocioError || !negocio) {
      return res.status(404).json({
        ok: false,
        error: "Business not found or inactive",
      });
    }

    const loaded = await loadReservaServiceRowsForDuration(reservaId, reserva.negocio_id);
    if (loaded.error) {
      return res.status(400).json({
        ok: false,
        error: loaded.error,
      });
    }

    const totalOccupiedMinutes = computeTotalOccupiedMinutes(
      loaded.selectedServiceRows,
      Number(negocio.duracion_buffer_min || 0)
    );
    const end = new Date(start.getTime() + totalOccupiedMinutes * 60 * 1000);

    const slotCheck = await assertSlotAvailable({
      negocio_id: reserva.negocio_id,
      staff_id: reserva.staff_id || null,
      start,
      end,
      excludeReservaId: reservaId,
    });

    if (!slotCheck.ok) {
      return res.status(slotCheck.status || 400).json({
        ok: false,
        error: slotCheck.error,
        step: slotCheck.step,
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from("reservas")
      .update({
        inicio_en: start.toISOString(),
        fin_en: end.toISOString(),
      })
      .eq("id", reservaId)
      .eq("usuario_id", user.id)
      .select("*")
      .single();

    if (updateError) {
      return res.status(500).json({
        ok: false,
        step: "update reserva reagendar",
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

const reagendarReservaAdmin = async (req, res) => {
  try {
    const user = req.user;
    const reservaId = req.params.id;
    const { inicio_en, staff_id } = req.body;

    if (!["admin", "staff"].includes(user.rol)) {
      return res.status(403).json({
        ok: false,
        error: "Only admin or staff can reschedule reservations",
      });
    }

    const negocioId = user.negocio_id;
    if (!negocioId) {
      return res.status(400).json({
        ok: false,
        error: "User has no business associated",
      });
    }

    if (!inicio_en) {
      return res.status(400).json({
        ok: false,
        error: "Start datetime is required",
      });
    }

    const start = new Date(inicio_en);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({
        ok: false,
        error: "Invalid start datetime",
      });
    }

    if (start <= new Date()) {
      return res.status(400).json({
        ok: false,
        error: "Start datetime must be in the future",
      });
    }

    const { data: reserva, error: reservaError } = await supabase
      .from("reservas")
      .select("*")
      .eq("id", reservaId)
      .eq("negocio_id", negocioId)
      .single();

    if (reservaError || !reserva) {
      return res.status(404).json({
        ok: false,
        error: "Reservation not found for this business",
      });
    }

    if (!RESCHEDULE_ALLOWED_ESTADOS.includes(reserva.estado)) {
      return res.status(400).json({
        ok: false,
        error: "Reservation cannot be rescheduled in its current status",
      });
    }

    const { data: negocio, error: negocioError } = await supabase
      .from("negocios")
      .select("id, activo, duracion_buffer_min")
      .eq("id", negocioId)
      .eq("activo", true)
      .single();

    if (negocioError || !negocio) {
      return res.status(404).json({
        ok: false,
        error: "Business not found or inactive",
      });
    }

    const loaded = await loadReservaServiceRowsForDuration(reservaId, negocioId);
    if (loaded.error) {
      return res.status(400).json({
        ok: false,
        error: loaded.error,
      });
    }

    const totalOccupiedMinutes = computeTotalOccupiedMinutes(
      loaded.selectedServiceRows,
      Number(negocio.duracion_buffer_min || 0)
    );
    const end = new Date(start.getTime() + totalOccupiedMinutes * 60 * 1000);

    const activeStaffResult = await listActiveStaffIdsForNegocio(negocioId);
    if (!activeStaffResult.ok) {
      return res.status(500).json({
        ok: false,
        step: "query active staff",
        error: activeStaffResult.error,
      });
    }
    const activeStaffIds = activeStaffResult.ids;

    let targetStaffId = reserva.staff_id || null;
    if (user.rol === "staff") {
      targetStaffId = user.id;
    } else if (staff_id !== undefined) {
      targetStaffId = String(staff_id || "").trim() || null;
    }

    if (!targetStaffId && activeStaffIds.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "staff_id is required to reschedule this reservation",
      });
    }

    if (targetStaffId) {
      const staffCheck = await resolveStaffForNegocio(negocioId, targetStaffId, {
        requireActive: true,
      });
      if (!staffCheck.ok) {
        return res.status(staffCheck.status || 400).json({
          ok: false,
          error: staffCheck.error,
          step: staffCheck.step,
        });
      }
    }

    const slotCheck = await assertSlotAvailable({
      negocio_id: negocioId,
      staff_id: targetStaffId,
      start,
      end,
      excludeReservaId: reservaId,
    });

    if (!slotCheck.ok) {
      return res.status(slotCheck.status || 400).json({
        ok: false,
        error: slotCheck.error,
        step: slotCheck.step,
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from("reservas")
      .update({
        staff_id: targetStaffId,
        inicio_en: start.toISOString(),
        fin_en: end.toISOString(),
      })
      .eq("id", reservaId)
      .eq("negocio_id", negocioId)
      .select("*")
      .single();

    if (updateError) {
      return res.status(500).json({
        ok: false,
        step: "update reserva reagendar admin",
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

const reassignReservaStaffAdmin = async (req, res) => {
  try {
    const user = req.user;
    const reservaId = req.params.id;
    const requestedStaffId = String(req.body.staff_id || "").trim();

    if (!["admin", "staff"].includes(user.rol)) {
      return res.status(403).json({
        ok: false,
        error: "Only admin or staff can reassign reservation staff",
      });
    }

    const negocioId = user.negocio_id;
    if (!negocioId) {
      return res.status(400).json({
        ok: false,
        error: "User has no business associated",
      });
    }

    if (!requestedStaffId) {
      return res.status(400).json({
        ok: false,
        error: "staff_id is required",
      });
    }

    if (user.rol === "staff" && requestedStaffId !== user.id) {
      return res.status(403).json({
        ok: false,
        error: "Staff can only assign reservations to themselves",
      });
    }

    const { data: reserva, error: reservaError } = await supabase
      .from("reservas")
      .select("*")
      .eq("id", reservaId)
      .eq("negocio_id", negocioId)
      .single();

    if (reservaError || !reserva) {
      return res.status(404).json({
        ok: false,
        error: "Reservation not found for this business",
      });
    }

    if (!RESCHEDULE_ALLOWED_ESTADOS.includes(reserva.estado)) {
      return res.status(400).json({
        ok: false,
        error: "Reservation cannot be reassigned in its current status",
      });
    }

    const staffCheck = await resolveStaffForNegocio(negocioId, requestedStaffId, {
      requireActive: true,
    });
    if (!staffCheck.ok) {
      return res.status(staffCheck.status || 400).json({
        ok: false,
        error: staffCheck.error,
        step: staffCheck.step,
      });
    }

    const start = new Date(reserva.inicio_en);
    const end = new Date(reserva.fin_en);
    const slotCheck = await assertSlotAvailable({
      negocio_id: negocioId,
      staff_id: requestedStaffId,
      start,
      end,
      excludeReservaId: reservaId,
    });

    if (!slotCheck.ok) {
      return res.status(slotCheck.status || 400).json({
        ok: false,
        error: slotCheck.error,
        step: slotCheck.step,
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from("reservas")
      .update({
        staff_id: requestedStaffId,
      })
      .eq("id", reservaId)
      .eq("negocio_id", negocioId)
      .select("*")
      .single();

    if (updateError) {
      return res.status(500).json({
        ok: false,
        step: "update reserva staff",
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

module.exports = {
  createReservaCliente,
  createReservaAdmin,
  getDisponibilidadPublic,
  getFechasDisponiblesPublic,
  getReservasCliente,
  getReservasNegocio,
  updateReservaEstado,
  cancelReservaCliente,
  reagendarReservaCliente,
  reagendarReservaAdmin,
  reassignReservaStaffAdmin,
  calculateTotals,
  mapServiceDeposit,
  overlaps,
  computeTotalOccupiedMinutes,
  collectDaySlots,
};

