const supabase = require("../config/supabase");

const ESTADOS_PAGO_VALIDOS = [
  "creado",
  "pendiente",
  "pagado",
  "fallido",
  "cancelado",
  "reembolsado",
];

const getPagosNegocio = async (req, res) => {
  try {
    const user = req.user;

    if (!["admin", "staff"].includes(user.rol)) {
      return res.status(403).json({
        ok: false,
        error: "Only admin or staff can list business payments",
      });
    }

    const negocioId = user.negocio_id;
    if (!negocioId) {
      return res.status(400).json({
        ok: false,
        error: "User has no business associated",
      });
    }

    const { status, from, to, reserva_id } = req.query;

    // Load reservations for this business first, then query payments.
    const { data: reservas, error: reservasError } = await supabase
      .from("reservas")
      .select("id")
      .eq("negocio_id", negocioId);

    if (reservasError) {
      return res.status(500).json({
        ok: false,
        step: "query reservas for pagos",
        error: reservasError.message,
      });
    }

    const reservaIds = (reservas || []).map((r) => r.id);
    if (reservaIds.length === 0) {
      return res.json({
        ok: true,
        data: [],
        count: 0,
      });
    }

    let query = supabase
      .from("pagos")
      .select("*, reservas(id, inicio_en, estado, usuario_id)")
      .in("reserva_id", reservaIds)
      .order("creado_en", { ascending: false });

    if (reserva_id) query = query.eq("reserva_id", reserva_id);
    if (status && ESTADOS_PAGO_VALIDOS.includes(status)) query = query.eq("estado", status);
    if (from) query = query.gte("creado_en", from);
    if (to) query = query.lte("creado_en", to);

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        ok: false,
        step: "query pagos",
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
  getPagosNegocio,
};

