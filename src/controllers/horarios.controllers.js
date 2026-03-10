const supabase = require("../config/supabase");

// helper para validar días permitidos
const diasValidos = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];

// helper para saber si dos bloques se traslapan
// permite bloques pegados, por ejemplo:
// 09:00-13:00 y 13:00-18:00 
const haySolapamiento = (inicioA, finA, inicioB, finB) => {
  return inicioA < finB && finA > inicioB;
};

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
        error: "No tienes permisos para crear horarios",
      });
    }

    const {
      dia_semana,
      hora_inicio,
      hora_fin,
      activo = true,
    } = req.body;

    // validaciones base
    if (!dia_semana || !hora_inicio || !hora_fin) {
      return res.status(400).json({
        ok: false,
        error: "dia_semana, hora_inicio y hora_fin son requeridos",
      });
    }

    if (!diasValidos.includes(dia_semana)) {
      return res.status(400).json({
        ok: false,
        error: "dia_semana inválido",
      });
    }

    if (hora_inicio >= hora_fin) {
      return res.status(400).json({
        ok: false,
        error: "hora_inicio debe ser menor que hora_fin",
      });
    }

    // traer bloques activos del mismo día
    const { data: horariosExistentes, error: errorExistentes } = await supabase
      .from("horarios")
      .select("*")
      .eq("negocio_id", negocioId)
      .eq("dia_semana", dia_semana)
      .eq("activo", true);

    if (errorExistentes) {
      return res.status(500).json({
        ok: false,
        error: errorExistentes.message,
      });
    }

    // validar solapamiento
    for (const horario of horariosExistentes || []) {
      if (haySolapamiento(hora_inicio, hora_fin, horario.hora_inicio, horario.hora_fin)) {
        return res.status(400).json({
          ok: false,
          error: "El horario se traslapa con otro bloque existente",
        });
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
        error: "No tienes permisos para editar horarios",
      });
    }

    // buscar horario actual
    const { data: horarioActual, error: horarioError } = await supabase
      .from("horarios")
      .select("*")
      .eq("id", horarioId)
      .eq("negocio_id", negocioId)
      .single();

    if (horarioError || !horarioActual) {
      return res.status(404).json({
        ok: false,
        error: "Horario no encontrado",
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
        error: "dia_semana inválido",
      });
    }

    if (inicioFinal >= finFinal) {
      return res.status(400).json({
        ok: false,
        error: "hora_inicio debe ser menor que hora_fin",
      });
    }

    // buscar otros bloques activos del mismo día, excluyendo el actual
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
          error: "El horario se traslapa con otro bloque existente",
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

const deleteHorarioAdmin = async (req, res) => {
  try {
    const rolUser = req.user.rol;
    const negocioId = req.user.negocio_id;
    const horarioId = req.params.id;

    if (rolUser !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "No tienes permisos para eliminar horarios",
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
        error: "Horario no encontrado",
      });
    }

    const { data, error } = await supabase
      .from("horarios")
      .update({ activo: false })
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
  updateHorarioAdmin,
  deleteHorarioAdmin,
};