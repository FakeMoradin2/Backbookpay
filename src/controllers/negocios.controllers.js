const supabase = require('../config/supabase');


const getNegocios = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('negocios')
      .select('*')
      .eq('activo', true)
      .order('nombre', { ascending: true });

    if (error) {
      return res.status(500).json({
        ok: false,
        step: 'query negocios',
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
      step: 'exception',
      error: e.message,
    });
  }
};

const getNegocioPublic = async (req, res) => {
  try {

    const negocioId = req.params.id;

    const { data, error } = await supabase
      .from('negocios')
      .select('*')
      .eq('id', negocioId)
      .eq('activo', true)
      .single();

    if (error) {
      return res.status(404).json({
        ok: false,
        error: 'Business not found',
      });
    }

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

const getNegocioAdmin = async (req, res) => {
  try {

    const negocioId = req.user.negocio_id;

    const { data, error } = await supabase
      .from('negocios')
      .select('*')
      .eq('id', negocioId)
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
        error: 'Business not found',
      });
    }

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

const updateNegocioAdmin = async (req, res) => {
  try {

    const negocioId = req.user.negocio_id;
    const rolUser = req.user.rol;

    if (rolUser !== 'admin') {
      return res.status(403).json({
        ok: false,
        error: 'You do not have permission to update the business',
      });
    }

    const {
      nombre,
      telefono,
      correo,
      zona_horaria,
      duracion_buffer_min,
      imagen
    } = req.body;

    const updateData = {};

    if (nombre !== undefined) updateData.nombre = nombre;
    if (telefono !== undefined) updateData.telefono = telefono;
    if (correo !== undefined) updateData.correo = correo;
    if (zona_horaria !== undefined) updateData.zona_horaria = zona_horaria;
    if (duracion_buffer_min !== undefined) updateData.duracion_buffer_min = duracion_buffer_min;
    if (imagen !== undefined) updateData.imagen = imagen;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'No fields were provided for update',
      });
    }

    const { data, error } = await supabase
      .from('negocios')
      .update(updateData)
      .eq('id', negocioId)
      .select('*')
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
      step: 'exception',
      error: e.message,
    });
  }
};


module.exports = {
  getNegocios,
  getNegocioPublic,
  getNegocioAdmin,
  updateNegocioAdmin,
};