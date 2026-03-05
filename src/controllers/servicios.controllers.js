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

module.exports = {
  getServicios,
  getServiciosAdmin,
  createServicio,
};