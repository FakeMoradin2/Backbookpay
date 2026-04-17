-- =============================================================================
-- Rúbrica: usuarios y privilegios (GRANT / REVOKE)
-- Motor: PostgreSQL 14+
-- Ejecutar DESPUÉS de existir el esquema public y las tablas de la app.
-- =============================================================================

-- Extensión para contraseñas seguras de roles de login (opcional)
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Roles de grupo (sin LOGIN): políticas de la rúbrica
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rubric_analista') THEN
    CREATE ROLE rubric_analista NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rubric_editor') THEN
    CREATE ROLE rubric_editor NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rubric_admin_db') THEN
    CREATE ROLE rubric_admin_db NOLOGIN;
  END IF;
END
$$;

-- Analista: solo lectura (SELECT) sobre public
GRANT USAGE ON SCHEMA public TO rubric_analista;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO rubric_analista;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO rubric_analista;

-- Editor: DML sobre tablas operativas (sin auth.users ni esquema auth)
GRANT USAGE ON SCHEMA public TO rubric_editor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO rubric_editor;
GRANT INSERT, UPDATE, DELETE ON TABLE
  public.negocios,
  public.servicios,
  public.horarios,
  public.reservas,
  public.reserva_servicios,
  public.bloqueos,
  public.pagos
TO rubric_editor;
-- Revocar lectura/escritura sobre perfiles si se considera sensible:
-- REVOKE ALL ON TABLE public.usuarios FROM rubric_editor;

-- Admin DB: control amplio (DDL sobre objetos existentes + DCL típico de curso)
GRANT USAGE ON SCHEMA public TO rubric_admin_db WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO rubric_admin_db WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO rubric_admin_db WITH GRANT OPTION;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO rubric_admin_db;

-- ---------------------------------------------------------------------------
-- Usuarios de login de demostración (cambiar contraseñas en producción)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'usr_rubric_analista') THEN
    CREATE USER usr_rubric_analista WITH PASSWORD 'Cambiar_Analyst_2026!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'usr_rubric_editor') THEN
    CREATE USER usr_rubric_editor WITH PASSWORD 'Cambiar_Editor_2026!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'usr_rubric_admin') THEN
    CREATE USER usr_rubric_admin WITH PASSWORD 'Cambiar_AdminDB_2026!';
  END IF;
END
$$;

GRANT rubric_analista TO usr_rubric_analista;
GRANT rubric_editor TO usr_rubric_editor;
GRANT rubric_admin_db TO usr_rubric_admin;

-- Ejemplo de REVOKE: quitar DELETE al editor sobre negocios (política más estricta)
REVOKE DELETE ON TABLE public.negocios FROM rubric_editor;

-- Notas Supabase:
-- - Algunos comandos pueden requerir ejecutarse como superusuario o desde el panel de roles.
-- - No otorgar privilegios al esquema auth salvo requerimiento explícito de seguridad.
