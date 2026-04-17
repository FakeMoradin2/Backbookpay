const supabase = require('../config/supabase');
const { mapPostgresError } = require("../utils/postgresErrors");

/** Deposit rules (fijo / porcentaje) require Stripe Connect ready to charge online. */
async function negocioStripeDepositsReady(negocioId) {
  if (!negocioId) return false;
  const { data, error } = await supabase
    .from("negocios")
    .select("stripe_connect_account_id, stripe_connect_charges_enabled")
    .eq("id", negocioId)
    .single();
  if (error || !data) return false;
  return !!(data.stripe_connect_account_id && data.stripe_connect_charges_enabled);
}

const getServicios = async (req, res) => {
  try {
    const { negocio_id, q, include_business } = req.query;

    let query = supabase
      .from("servicios")
      .select(
        include_business === "true"
          ? "*, negocios(id, nombre, zona_horaria, imagen_url)"
          : "*"
      )
      .eq("activo", true);

    if (negocio_id) {
      query = query.eq("negocio_id", negocio_id);
    }

    if (q && String(q).trim()) {
      const text = String(q).trim();
      query = query.or(`nombre.ilike.%${text}%,descripcion.ilike.%${text}%`);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        ok: false,
        step: "query servicios",
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

const getServiciosAdmin = async (req, res) => {
  try {
    const negocioId = req.user.negocio_id;

    const { data, error } = await supabase
      .from('servicios')
      .select('*')
      .eq('negocio_id', negocioId)
      .eq('activo', true)
      .order('creado_en', { ascending: false });

    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
      });
    }

    return res.json({
      ok: true,
      data,
      count: data.length,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: 'exception',
      error: e.message,
    });
  }
};

const createServicio = async (req, res) => {
  try {
    const rolUser = req.user.rol;

    if (rolUser !== 'admin') {
      return res.status(403).json({
        ok: false,
        error: 'You do not have permission to create services',
      });
    }

    const negocioUser = req.user.negocio_id;

    const {
      nombre,
      descripcion,
      duracion_min,
      buffer_min,
      precio,
      anticipo_tipo,
      anticipo_valor,
      activo = true,
      imagen_url = null,
    } = req.body;

    // Minimum validations
    if (!nombre || !duracion_min || precio === undefined || !anticipo_tipo) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: nombre, duracion_min, precio, anticipo_tipo',
      });
    }

    if (!['fijo', 'porcentaje', 'no_requiere'].includes(anticipo_tipo)) {
      return res.status(400).json({ ok: false, error: 'Invalid anticipo_tipo value' });
    }

    const dur = Number(duracion_min);
    const pr = Number(precio);
    const bf = buffer_min === undefined || buffer_min === null ? null : Number(buffer_min);

    if (!Number.isFinite(dur) || dur <= 0) {
      return res.status(400).json({ ok: false, error: 'duracion_min must be greater than 0' });
    }

    if (!Number.isFinite(pr) || pr < 0) {
      return res.status(400).json({ ok: false, error: 'precio must be greater than or equal to 0' });
    }
    if (bf !== null && (!Number.isFinite(bf) || bf < 0)) {
      return res.status(400).json({ ok: false, error: "buffer_min must be greater than or equal to 0" });
    }

    let anticipoFinal = anticipo_valor;

    if (anticipo_tipo === 'no_requiere') {
      anticipoFinal = null;
    } else {
      const av = Number(anticipo_valor);
      if (!Number.isFinite(av)) {
        return res.status(400).json({ ok: false, error: 'anticipo_valor is required' });
      }

      if (anticipo_tipo === 'fijo' && av <= 0) {
        return res.status(400).json({ ok: false, error: 'anticipo_valor must be greater than 0' });
      }

      if (anticipo_tipo === 'porcentaje' && (av < 1 || av > 100)) {
        return res.status(400).json({ ok: false, error: 'anticipo_valor must be between 1 and 100' });
      }

      anticipoFinal = av;
    }

    if (anticipo_tipo === "fijo" || anticipo_tipo === "porcentaje") {
      const stripeOk = await negocioStripeDepositsReady(negocioUser);
      if (!stripeOk) {
        return res.status(400).json({
          ok: false,
          error:
            "Configure Stripe under Payments (connect and enable charges) before requiring a deposit on services.",
        });
      }
    }

    const { data, error } = await supabase
      .from('servicios')
      .insert({
        negocio_id: negocioUser,
        nombre,
        descripcion: descripcion ?? null,
        duracion_min: dur,
        buffer_min: bf,
        precio: pr,
        anticipo_tipo,
        anticipo_valor: anticipoFinal,
        activo,
        imagen_url,
      })
      .select('*')
      .single();

    if (error) {
      const mapped = mapPostgresError(error);
      return res.status(mapped.status).json(mapped.body);
    }

    return res.status(201).json({
      ok: true,
      data,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: 'exception',
      error: e.message,
    });
  }
};


const updateServicio = async (req, res) => {
  try {
    const rolUser = req.user.rol;
    const negocioId = req.user.negocio_id;
    const servicioId = req.params.id;

    if (rolUser !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "You do not have permission to edit services",
      });
    }

    const { data: servicioActual, error: servicioError } = await supabase
      .from("servicios")
      .select("*")
      .eq("id", servicioId)
      .eq("negocio_id", negocioId)
      .single();

    if (servicioError || !servicioActual) {
      return res.status(404).json({
        ok: false,
        error: "Service not found",
      });
    }

    const {
      nombre,
      descripcion,
      duracion_min,
      buffer_min,
      precio,
      anticipo_tipo,
      anticipo_valor,
      activo,
      imagen_url,
    } = req.body;

    const updateData = {};

    if (nombre !== undefined) {
      if (!nombre.trim()) {
        return res.status(400).json({
          ok: false,
          error: "Service name cannot be empty",
        });
      }
      updateData.nombre = nombre;
    }

    if (descripcion !== undefined) updateData.descripcion = descripcion;

    if (duracion_min !== undefined) {
      const dur = Number(duracion_min);
      if (!Number.isFinite(dur) || dur <= 0) {
        return res.status(400).json({
          ok: false,
          error: "duracion_min must be greater than 0",
        });
      }
      updateData.duracion_min = dur;
    }

    if (buffer_min !== undefined) {
      const bf = Number(buffer_min);
      if (!Number.isFinite(bf) || bf < 0) {
        return res.status(400).json({
          ok: false,
          error: "buffer_min must be greater than or equal to 0",
        });
      }
      updateData.buffer_min = bf;
    }

    if (precio !== undefined) {
      const pr = Number(precio);
      if (!Number.isFinite(pr) || pr < 0) {
        return res.status(400).json({
          ok: false,
          error: "precio must be greater than or equal to 0",
        });
      }
      updateData.precio = pr;
    }

    if (activo !== undefined) updateData.activo = activo;
    if (imagen_url !== undefined) updateData.imagen_url = imagen_url;

    const tipoFinal = anticipo_tipo !== undefined ? anticipo_tipo : servicioActual.anticipo_tipo;
    const valorFinal = anticipo_valor !== undefined ? anticipo_valor : servicioActual.anticipo_valor;

    if (anticipo_tipo !== undefined || anticipo_valor !== undefined) {
      if (!["fijo", "porcentaje", "no_requiere"].includes(tipoFinal)) {
        return res.status(400).json({
          ok: false,
          error: "Invalid anticipo_tipo value",
        });
      }

      if (tipoFinal === "no_requiere") {
        updateData.anticipo_tipo = "no_requiere";
        updateData.anticipo_valor = null;
      }

      if (tipoFinal === "fijo") {
        const av = Number(valorFinal);
        if (!Number.isFinite(av) || av <= 0) {
          return res.status(400).json({
            ok: false,
            error: "anticipo_valor must be greater than 0",
          });
        }

        updateData.anticipo_tipo = "fijo";
        updateData.anticipo_valor = av;
      }

      if (tipoFinal === "porcentaje") {
        const av = Number(valorFinal);
        if (!Number.isFinite(av) || av < 1 || av > 100) {
          return res.status(400).json({
            ok: false,
            error: "anticipo_valor must be between 1 and 100",
          });
        }

        updateData.anticipo_tipo = "porcentaje";
        updateData.anticipo_valor = av;
      }
    }

    const effectiveAnticipoTipo =
      updateData.anticipo_tipo !== undefined
        ? updateData.anticipo_tipo
        : servicioActual.anticipo_tipo;

    if (effectiveAnticipoTipo === "fijo" || effectiveAnticipoTipo === "porcentaje") {
      const stripeOk = await negocioStripeDepositsReady(negocioId);
      if (!stripeOk) {
        return res.status(400).json({
          ok: false,
          error:
            "Configure Stripe under Payments (connect and enable charges) before requiring a deposit on services.",
        });
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No fields were provided for update",
      });
    }

    const { data, error } = await supabase
      .from("servicios")
      .update(updateData)
      .eq("id", servicioId)
      .eq("negocio_id", negocioId)
      .select("*")
      .single();

    if (error) {
      const mapped = mapPostgresError(error);
      return res.status(mapped.status).json(mapped.body);
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


// Soft delete for services (set activo=false)
const deleteServicio = async (req, res) => {
  try {
    const rolUser = req.user.rol;
    const negocioId = req.user.negocio_id;
    const servicioId = req.params.id;

    if (rolUser !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "You do not have permission to delete services",
      });
    }

    const { data, error } = await supabase
      .from("servicios")
      .select("*")
      .eq("id", servicioId)
      .eq("negocio_id", negocioId)
      .eq("activo", true)
      .single();

    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({
        ok: false,
        error: "Service not found",
      });
    }

    const { data: dataUpdate, error: errorUpdate } = await supabase
      .from("servicios")
      .update({ activo: false })
      .eq("id", servicioId)
      .eq("negocio_id", negocioId)
      .select("*")
      .single();

    if (errorUpdate) {
      const mapped = mapPostgresError(errorUpdate);
      return res.status(mapped.status).json(mapped.body);
    }

    return res.json({
      ok: true,
      data: dataUpdate,
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
  getServicios,
  getServiciosAdmin,
  createServicio,
  updateServicio,
  deleteServicio,
};