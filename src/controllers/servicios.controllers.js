const supabase = require('../config/supabase');

const getServicios = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('servicios')
      .select('*');

    return res.json({
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
        error: 'No tienes permisos para crear servicios',
      });
    }

    const negocioUser = req.user.negocio_id;

    const {
      nombre,
      descripcion,
      duracion_min,
      precio,
      anticipo_tipo,
      anticipo_valor,
      activo = true,
      imagen_url = null,
    } = req.body;

    // Validaciones mínimas
    if (!nombre || !duracion_min || precio === undefined || !anticipo_tipo) {
      return res.status(400).json({
        ok: false,
        error: 'Faltan campos requeridos: nombre, duracion_min, precio, anticipo_tipo',
      });
    }

    if (!['fijo', 'porcentaje', 'no_requiere'].includes(anticipo_tipo)) {
      return res.status(400).json({ ok: false, error: 'anticipo_tipo inválido' });
    }

    const dur = Number(duracion_min);
    const pr = Number(precio);

    if (!Number.isFinite(dur) || dur <= 0) {
      return res.status(400).json({ ok: false, error: 'duracion_min debe ser > 0' });
    }

    if (!Number.isFinite(pr) || pr < 0) {
      return res.status(400).json({ ok: false, error: 'precio debe ser >= 0' });
    }

    let anticipoFinal = anticipo_valor;

    if (anticipo_tipo === 'no_requiere') {
      anticipoFinal = null;
    } else {
      const av = Number(anticipo_valor);
      if (!Number.isFinite(av)) {
        return res.status(400).json({ ok: false, error: 'anticipo_valor es requerido' });
      }

      if (anticipo_tipo === 'fijo' && av <= 0) {
        return res.status(400).json({ ok: false, error: 'anticipo_valor debe ser > 0' });
      }

      if (anticipo_tipo === 'porcentaje' && (av < 1 || av > 100)) {
        return res.status(400).json({ ok: false, error: 'anticipo_valor debe estar entre 1 y 100' });
      }

      anticipoFinal = av;
    }

    const { data, error } = await supabase
      .from('servicios')
      .insert({
        negocio_id: negocioUser,
        nombre,
        descripcion: descripcion ?? null,
        duracion_min: dur,
        precio: pr,
        anticipo_tipo,
        anticipo_valor: anticipoFinal,
        activo,
        imagen_url,
      })
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({
        ok: false,
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
        error: "No tienes permisos para editar servicios",
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
        error: "Servicio no encontrado",
      });
    }

    const {
      nombre,
      descripcion,
      duracion_min,
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
          error: "El nombre no puede estar vacío",
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
          error: "duracion_min debe ser mayor a 0",
        });
      }
      updateData.duracion_min = dur;
    }

    if (precio !== undefined) {
      const pr = Number(precio);
      if (!Number.isFinite(pr) || pr < 0) {
        return res.status(400).json({
          ok: false,
          error: "precio debe ser mayor o igual a 0",
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
          error: "anticipo_tipo inválido",
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
            error: "anticipo_valor debe ser mayor a 0",
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
            error: "anticipo_valor debe estar entre 1 y 100",
          });
        }

        updateData.anticipo_tipo = "porcentaje";
        updateData.anticipo_valor = av;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No se enviaron campos para actualizar",
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


//delete servicio solo hace un soft delete, no borra por completo de la base de datos
const deleteServicio = async (req, res) => {
  try {
    const rolUser = req.user.rol;
    const negocioId = req.user.negocio_id;
    const servicioId = req.params.id;

    if (rolUser !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "No tienes permisos para eliminar servicios",
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
        error: "Servicio no encontrado",
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
      return res.status(500).json({
        ok: false,
        error: errorUpdate.message,
      });
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