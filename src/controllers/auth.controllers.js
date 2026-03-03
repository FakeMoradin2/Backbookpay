const supabase = require('../config/supabase');


//funcion de login
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                ok: false,
                error: 'Email y contraseña son requeridos',
            });
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            return res.status(400).json({
                ok: false,
                error: error.message,
            });
        }

        const session = data.session;

        return res.json({
            ok: true,
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_in: session.expires_in,
            token_type: session.token_type,
            user_id: data.user.id,
        });
    } catch (e) {
        return res.status(500).json({
            ok: false,
            error: e.message,
        });
    }
};

//funcion de me
const me = async (req, res) => {
    try {
        const user = req.user;
        return res.json({
            ok: true,
            user,
        });
    }
    catch (e) {
        return res.status(500).json({
            ok: false,
            error: e.message,
        });
    }
};

const register = async (req, res) => {
    try {
      const { email, password, nombre, rol = "cliente", invite_code, negocio_id } = req.body;
  
      // 1) Validaciones base
      if (!email || !password || !nombre) {
        return res.status(400).json({
          ok: false,
          error: "Email, contraseña y/o nombre son requeridos",
        });
      }
  
      if (!["admin", "staff", "cliente"].includes(rol)) {
        return res.status(400).json({
          ok: false,
          error: "Rol inválido",
        });
      }
  
      // 2) Validación de admin
      if (rol === "admin" && invite_code !== process.env.ADMIN_INVITE_CODE) {
        return res.status(403).json({
          ok: false,
          error: "Código de invitación inválido",
        });
      }
  
      // 3) Crear usuario en Supabase Auth (aquí vive la contraseña)
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: nombre },
        },
      });
  
      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message,
        });
      }
  
      const userId = data?.user?.id;
      if (!userId) {
        return res.status(500).json({
          ok: false,
          error: "No se pudo obtener el userId después del registro",
        });
      }
  
      // 4) Determinar negocio_id final
      let finalNegocioId = null;
  
      if (rol === "cliente") {
        finalNegocioId = null;
      }
  
      if (rol === "staff") {
        if (!negocio_id) {
          return res.status(400).json({
            ok: false,
            error: "Negocio es requerido para staff",
          });
        }
        finalNegocioId = negocio_id;
      }
  
      if (rol === "admin") {
        // Para admin: siempre crear negocio por default
        const { data: negocioCreado, error: negocioError } = await supabase
          .from("negocios")
          .insert({
            nombre: `negocio de ${nombre}`,
            zona_horaria: "america/mexico_city",
            duracion_buffer_min: 0,
            activo: true,
          })
          .select("id")
          .single();
  
        if (negocioError) {
          return res.status(500).json({
            ok: false,
            error: negocioError.message,
          });
        }
  
        finalNegocioId = negocioCreado.id;
      }
  
      // 5) Actualizar perfil en public.usuarios (trigger lo crea como cliente)
      const { error: perfilError } = await supabase
        .from("usuarios")
        .update({
          nombre,
          rol,
          negocio_id: finalNegocioId,
          activo: true,
        })
        .eq("id", userId);
  
      if (perfilError) {
        return res.status(500).json({
          ok: false,
          error: perfilError.message,
        });
      }
  
      // 6) Respuesta según reglas
      if (rol === "admin") {
        return res.status(201).json({
          ok: true,
          message: "Cuenta admin creada. Inicia sesión para obtener token.",
          user_id: userId,
          negocio_id: finalNegocioId,
        });
      }
  
      // staff/cliente: devolver tokens si existen
      const session = data.session;
  
      if (!session) {
        // pasa cuando hay confirmación de email activada
        return res.status(201).json({
          ok: true,
          message: "Cuenta creada. Inicia sesión para obtener token.",
          user_id: userId,
        });
      }
  
      return res.status(201).json({
        ok: true,
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        token_type: session.token_type,
        user_id: userId,
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  };

 //funcion de refresh
  const refresh = async (req, res) => {
    try {
      const { refresh_token } = req.body;
  
      if (!refresh_token) {
        return res.status(400).json({
          ok: false,
          error: "Falta refresh_token",
        });
      }
  
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token,
      });
  
      if (error || !data?.session) {
        return res.status(401).json({
          ok: false,
          error: error?.message || "No se pudo refrescar sesión",
        });
      }
  
      return res.json({
        ok: true,
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in: data.session.expires_in,
        token_type: data.session.token_type,
      });
  
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  };

  //funcion de logout
  const logout = async (req, res) => {
    return res.json({
      ok: true,
      message: "Logout correcto. El cliente debe eliminar los tokens.",
    });
  };

module.exports = {
    login,
    me,
    register,
    refresh,
    logout,
};