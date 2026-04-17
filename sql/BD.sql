-- =============================================================================
-- BD.sql - Estructura completa de BackBookNPay (PostgreSQL / Supabase)
--
-- Incluye:
-- - Extensiones
-- - Tablas principales y relaciones (PK/FK)
-- - Constraints CHECK y EXCLUDE
-- - Triggers y funciones
-- - Indices
-- - Policies de Supabase Storage
-- - Roles y privilegios (seccion de rubrica)
--
-- Nota:
-- - Este archivo esta pensado para levantar esquema en entorno nuevo.
-- - Si tu BD ya tiene datos, revisar conflictos de EXCLUDE por solapes.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extensiones
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Tabla: negocios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.negocios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre varchar(200) NOT NULL,
  telefono varchar(40),
  correo varchar(150),
  zona_horaria varchar(80) NOT NULL DEFAULT 'america/mexico_city',
  duracion_buffer_min integer,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  imagen_url text,
  stripe_connect_account_id text,
  stripe_connect_charges_enabled boolean NOT NULL DEFAULT false,
  stripe_connect_details_submitted boolean NOT NULL DEFAULT false,
  CONSTRAINT ck_negocios_duracion_buffer_nonneg
    CHECK (duracion_buffer_min IS NULL OR duracion_buffer_min >= 0)
);

COMMENT ON COLUMN public.negocios.stripe_connect_account_id IS 'Stripe Connect Express account id (acct_xxx)';
COMMENT ON COLUMN public.negocios.stripe_connect_charges_enabled IS 'Synced from Stripe account.updated';
COMMENT ON COLUMN public.negocios.stripe_connect_details_submitted IS 'Onboarding submitted';

-- ---------------------------------------------------------------------------
-- Tabla: usuarios (perfil app, id vinculado a auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usuarios (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  negocio_id uuid REFERENCES public.negocios(id) ON DELETE SET NULL,
  nombre varchar(200) NOT NULL,
  correo varchar(255) NOT NULL,
  telefono varchar(40),
  rol varchar(20) NOT NULL DEFAULT 'cliente',
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_usuarios_rol_valido CHECK (rol IN ('admin', 'staff', 'cliente'))
);

CREATE INDEX IF NOT EXISTS idx_usuarios_negocio_id ON public.usuarios(negocio_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_correo_lower ON public.usuarios(lower(correo));

-- ---------------------------------------------------------------------------
-- Tabla: servicios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.servicios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id uuid NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
  nombre varchar(200) NOT NULL,
  descripcion text,
  duracion_min integer NOT NULL,
  buffer_min integer NOT NULL DEFAULT 0,
  precio numeric(14,2) NOT NULL,
  anticipo_tipo varchar(20),
  anticipo_valor numeric(14,2),
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  imagen_url text,
  CONSTRAINT ck_servicios_duracion_positiva CHECK (duracion_min IS NULL OR duracion_min > 0),
  CONSTRAINT ck_servicios_precio_nonneg CHECK (precio IS NULL OR precio >= 0),
  CONSTRAINT ck_servicios_buffer_nonneg CHECK (buffer_min >= 0),
  CONSTRAINT ck_servicios_anticipo_tipo
    CHECK (anticipo_tipo IS NULL OR anticipo_tipo IN ('fijo', 'porcentaje', 'no_requiere')),
  CONSTRAINT ck_servicios_anticipo_valor_por_tipo
    CHECK (
      anticipo_tipo IS NULL
      OR (anticipo_tipo = 'no_requiere' AND anticipo_valor IS NULL)
      OR (anticipo_tipo = 'fijo' AND anticipo_valor IS NOT NULL AND anticipo_valor > 0)
      OR (
        anticipo_tipo = 'porcentaje'
        AND anticipo_valor IS NOT NULL
        AND anticipo_valor >= 1
        AND anticipo_valor <= 100
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_servicios_negocio_id ON public.servicios(negocio_id);

-- ---------------------------------------------------------------------------
-- Tabla: horarios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.horarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id uuid NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
  dia_semana varchar(3) NOT NULL,
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_horarios_dia_semana CHECK (dia_semana IN ('lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom')),
  CONSTRAINT ck_horarios_inicio_antes_fin CHECK (hora_inicio::time < hora_fin::time)
);

CREATE INDEX IF NOT EXISTS idx_horarios_negocio_dia ON public.horarios(negocio_id, dia_semana);

-- EXCLUDE: sin traslape de bloques activos por negocio/dia
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'excl_horarios_no_solape_activos'
  ) THEN
    BEGIN
      ALTER TABLE public.horarios
        ADD CONSTRAINT excl_horarios_no_solape_activos
        EXCLUDE USING gist (
          negocio_id WITH =,
          dia_semana WITH =,
          int4range(
            (
              EXTRACT(hour FROM hora_inicio::time)::int * 60
              + EXTRACT(minute FROM hora_inicio::time)::int
            ),
            (
              EXTRACT(hour FROM hora_fin::time)::int * 60
              + EXTRACT(minute FROM hora_fin::time)::int
            ),
            '[)'
          ) WITH &&
        )
        WHERE (activo = true);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING
          'No se creo excl_horarios_no_solape_activos (solapes existentes): %',
          SQLERRM;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Tabla: bloqueos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bloqueos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id uuid NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
  inicio_en timestamptz NOT NULL,
  fin_en timestamptz NOT NULL,
  motivo varchar(300),
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_bloqueos_fin_despues_inicio CHECK (fin_en > inicio_en)
);

CREATE INDEX IF NOT EXISTS idx_bloqueos_negocio_inicio ON public.bloqueos(negocio_id, inicio_en);

-- ---------------------------------------------------------------------------
-- Tabla: reservas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reservas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id uuid NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
  usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  staff_id uuid,
  inicio_en timestamptz NOT NULL,
  fin_en timestamptz NOT NULL,
  estado varchar(30) NOT NULL,
  precio_total numeric(14,2),
  anticipo_calculado numeric(14,2),
  saldo_pendiente numeric(14,2),
  nota text,
  cliente_manual_nombre varchar(100),
  cliente_manual_correo varchar(150),
  cliente_manual_telefono varchar(20),
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservas_staff_id_fkey
    FOREIGN KEY (staff_id) REFERENCES public.usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT ck_reservas_fin_despues_inicio CHECK (fin_en > inicio_en),
  CONSTRAINT ck_reservas_estado_valido
    CHECK (estado IN ('pendiente_pago', 'confirmada', 'cancelada', 'completada', 'no_show', 'expirada')),
  CONSTRAINT ck_reservas_precios_no_negativos
    CHECK (
      (precio_total IS NULL OR precio_total >= 0)
      AND (anticipo_calculado IS NULL OR anticipo_calculado >= 0)
      AND (saldo_pendiente IS NULL OR saldo_pendiente >= 0)
    ),
  CONSTRAINT ck_reservas_anticipo_no_mayor_total
    CHECK (
      precio_total IS NULL
      OR anticipo_calculado IS NULL
      OR anticipo_calculado <= precio_total
    ),
  CONSTRAINT ck_reservas_cliente_usuario_o_manual
    CHECK (
      usuario_id IS NOT NULL
      OR (
        cliente_manual_nombre IS NOT NULL
        AND length(btrim(cliente_manual_nombre)) > 0
      )
    ),
  CONSTRAINT ck_reservas_cliente_manual_nombre_nonempty
    CHECK (
      cliente_manual_nombre IS NULL
      OR length(btrim(cliente_manual_nombre)) > 0
    )
);

CREATE INDEX IF NOT EXISTS idx_reservas_negocio_inicio ON public.reservas(negocio_id, inicio_en);
CREATE INDEX IF NOT EXISTS idx_reservas_usuario_id ON public.reservas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_reservas_staff_id ON public.reservas(staff_id);
CREATE INDEX IF NOT EXISTS idx_reservas_negocio_staff_inicio
  ON public.reservas(negocio_id, staff_id, inicio_en);

-- EXCLUDE: no traslape entre reservas activas (estado <> cancelada)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'excl_reservas_no_solape_activas'
  ) THEN
    BEGIN
      ALTER TABLE public.reservas
        ADD CONSTRAINT excl_reservas_no_solape_activas
        EXCLUDE USING gist (
          negocio_id WITH =,
          tstzrange(inicio_en, fin_en, '[)') WITH &&
        )
        WHERE (estado IS DISTINCT FROM 'cancelada');
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING
          'No se creo excl_reservas_no_solape_activas (solapes existentes): %',
          SQLERRM;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Tabla: reserva_servicios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reserva_servicios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reserva_id uuid NOT NULL REFERENCES public.reservas(id) ON DELETE CASCADE,
  servicio_id uuid NOT NULL REFERENCES public.servicios(id) ON DELETE RESTRICT,
  cantidad integer NOT NULL DEFAULT 1,
  duracion_min integer,
  precio numeric(14,2),
  anticipo_calculado numeric(14,2),
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_reserva_servicios_cantidad_positiva CHECK (cantidad IS NULL OR cantidad > 0),
  CONSTRAINT ck_reserva_servicios_precio_nonneg CHECK (precio IS NULL OR precio >= 0),
  CONSTRAINT ck_reserva_servicios_anticipo_nonneg CHECK (anticipo_calculado IS NULL OR anticipo_calculado >= 0),
  CONSTRAINT ck_reserva_servicios_duracion_positiva CHECK (duracion_min IS NULL OR duracion_min > 0)
);

CREATE INDEX IF NOT EXISTS idx_reserva_servicios_reserva ON public.reserva_servicios(reserva_id);
CREATE INDEX IF NOT EXISTS idx_reserva_servicios_servicio ON public.reserva_servicios(servicio_id);

-- ---------------------------------------------------------------------------
-- Tabla: pagos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reserva_id uuid NOT NULL REFERENCES public.reservas(id) ON DELETE CASCADE,
  tipo varchar(30) NOT NULL DEFAULT 'anticipo',
  monto numeric(14,2) NOT NULL DEFAULT 0,
  moneda char(3) NOT NULL DEFAULT 'mxn',
  metodo varchar(30) NOT NULL DEFAULT 'stripe',
  estado varchar(30) NOT NULL DEFAULT 'creado',
  referencia varchar(255),
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_pagos_estado_valido
    CHECK (estado IN ('creado', 'pendiente', 'pagado', 'fallido', 'cancelado', 'reembolsado'))
);

CREATE INDEX IF NOT EXISTS idx_pagos_reserva ON public.pagos(reserva_id);
CREATE INDEX IF NOT EXISTS idx_pagos_creado_en ON public.pagos(creado_en DESC);

-- ---------------------------------------------------------------------------
-- Trigger: reservas no pueden solapar bloqueos activos del negocio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_reservas_no_solapar_bloqueos()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM 'cancelada' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bloqueos b
    WHERE b.negocio_id = NEW.negocio_id
      AND tstzrange(NEW.inicio_en, NEW.fin_en, '[)')
          && tstzrange(b.inicio_en, b.fin_en, '[)')
  ) THEN
    RAISE EXCEPTION 'La reserva se solapa con un bloqueo del negocio'
      USING errcode = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservas_bloqueos_biud ON public.reservas;
CREATE TRIGGER trg_reservas_bloqueos_biud
  BEFORE INSERT OR UPDATE OF inicio_en, fin_en, negocio_id, estado
  ON public.reservas
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_reservas_no_solapar_bloqueos();

-- ---------------------------------------------------------------------------
-- Trigger: crear perfil en public.usuarios al registrarse en auth.users
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usuarios (id, nombre, correo, rol, activo)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(COALESCE(NEW.email, ''), '@', 1)),
    COALESCE(NEW.email, ''),
    'cliente',
    true
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Supabase Storage: bucket y policies para business-assets
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'business-assets',
  'business-assets',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "business_assets_select_public" ON storage.objects;
CREATE POLICY "business_assets_select_public"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'business-assets');

DROP POLICY IF EXISTS "business_assets_insert_own_negocio" ON storage.objects;
CREATE POLICY "business_assets_insert_own_negocio"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'business-assets'
    AND EXISTS (
      SELECT 1
      FROM public.usuarios u
      WHERE u.id = auth.uid()
        AND u.negocio_id IS NOT NULL
        AND u.negocio_id::text = (string_to_array(name, '/'))[1]
    )
  );

DROP POLICY IF EXISTS "business_assets_update_own_negocio" ON storage.objects;
CREATE POLICY "business_assets_update_own_negocio"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'business-assets'
    AND EXISTS (
      SELECT 1
      FROM public.usuarios u
      WHERE u.id = auth.uid()
        AND u.negocio_id IS NOT NULL
        AND u.negocio_id::text = (string_to_array(name, '/'))[1]
    )
  )
  WITH CHECK (
    bucket_id = 'business-assets'
    AND EXISTS (
      SELECT 1
      FROM public.usuarios u
      WHERE u.id = auth.uid()
        AND u.negocio_id IS NOT NULL
        AND u.negocio_id::text = (string_to_array(name, '/'))[1]
    )
  );

DROP POLICY IF EXISTS "business_assets_delete_own_negocio" ON storage.objects;
CREATE POLICY "business_assets_delete_own_negocio"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'business-assets'
    AND EXISTS (
      SELECT 1
      FROM public.usuarios u
      WHERE u.id = auth.uid()
        AND u.negocio_id IS NOT NULL
        AND u.negocio_id::text = (string_to_array(name, '/'))[1]
    )
  );

-- ---------------------------------------------------------------------------
-- Roles y privilegios (rubrica)
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

GRANT USAGE ON SCHEMA public TO rubric_analista;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO rubric_analista;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO rubric_analista;

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
REVOKE DELETE ON TABLE public.negocios FROM rubric_editor;

GRANT USAGE ON SCHEMA public TO rubric_admin_db WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO rubric_admin_db WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO rubric_admin_db WITH GRANT OPTION;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO rubric_admin_db;

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

COMMIT;

-- =============================================================================
-- Recomendaciones de ejecucion
-- =============================================================================
-- 1) Si falla algun EXCLUDE por datos previos, ejecutar antes:
--    sql/2026-03-25-supabase-integrity-precheck.sql
-- 2) Ajustar passwords de usuarios rubric_* en cuanto se cree el entorno.
-- 3) Si no deseas crear roles de rubrica, comenta la seccion de privilegios.
-- =============================================================================
