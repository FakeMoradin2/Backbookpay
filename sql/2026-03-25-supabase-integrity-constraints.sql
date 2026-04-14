-- =============================================================================
-- Integridad en Supabase (alineado con BackBookNPay)
--
-- IMPORTANTE — restricciones ya existentes:
--   - Cada ADD usa el nombre fijo ck_* / excl_* y solo se aplica si ese nombre
--     NO está ya en pg_constraint (no duplica ni reemplaza otras restricciones).
--   - NO se hace DROP de constraints salvo triggers con nombre propio.
--
-- Si EXCLUDE falla por datos viejos: ejecuta antes
--   sql/2026-03-25-supabase-integrity-precheck.sql
-- corrige solapes en horarios/reservas y vuelve a ejecutar; las exclusiones
-- van en bloques que avisan (WARNING) y no tumban el resto del script.
--
-- Cubre en DB lo que hoy valida el backend:
--   - Horarios: mismo negocio/día, bloques activos sin traslape (adyacentes OK).
--   - Reservas: mismo negocio, intervalos sin traslape si estado <> cancelada.
--   - Bloqueos: fin > inicio.
--   - Reservas vs bloqueos: trigger (no solapar con bloqueos del mismo negocio).
--   - CHECKs: estados, precios/duraciones, anticipos de servicios, etc.
--
-- NO cubre en SQL puro (depende de zona horaria y lógica de negocio):
--   - Que la reserva caiga dentro de un bloque de horario del día (usa app/API).
--   - "inicio_en debe ser futuro" (cambiante; mantener en backend).
--
-- Requisito: extensión btree_gist (en Supabase: Database > Extensions > btree_gist).
-- =============================================================================

create extension if not exists btree_gist;

-- -----------------------------------------------------------------------------
-- negocios
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_negocios_duracion_buffer_nonneg'
  ) then
    alter table public.negocios
      add constraint ck_negocios_duracion_buffer_nonneg
      check (duracion_buffer_min is null or duracion_buffer_min >= 0);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- horarios: hora_inicio < hora_fin; día válido; sin traslape entre filas activas
-- (Misma semántica que haySolapamiento: 09:00–12:00 y 12:00–15:00 NO traslapan.)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_horarios_dia_semana'
  ) then
    alter table public.horarios
      add constraint ck_horarios_dia_semana
      check (dia_semana in ('lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_horarios_inicio_antes_fin'
  ) then
    alter table public.horarios
      add constraint ck_horarios_inicio_antes_fin
      check (hora_inicio::time < hora_fin::time);
  end if;
end $$;

-- EXCLUDE horarios: solo si no existe; fallo por datos → WARNING (no aborta el archivo)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'excl_horarios_no_solape_activos'
  ) then
    begin
      alter table public.horarios
        add constraint excl_horarios_no_solape_activos
        exclude using gist (
          negocio_id with =,
          dia_semana with =,
          int4range(
            (
              extract(hour from hora_inicio::time)::int * 60
              + extract(minute from hora_inicio::time)::int
            ),
            (
              extract(hour from hora_fin::time)::int * 60
              + extract(minute from hora_fin::time)::int
            ),
            '[)'
          ) with &&
        )
        where (activo = true);
    exception
      when others then
        raise warning
          'No se creó excl_horarios_no_solape_activos (¿solapes en horarios?): %',
          sqlerrm;
    end;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- bloqueos
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_bloqueos_fin_despues_inicio'
  ) then
    alter table public.bloqueos
      add constraint ck_bloqueos_fin_despues_inicio
      check (fin_en > inicio_en);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- reservas: fin > inicio; estado válido; sin traslape entre no-canceladas
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_reservas_fin_despues_inicio'
  ) then
    alter table public.reservas
      add constraint ck_reservas_fin_despues_inicio
      check (fin_en > inicio_en);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_reservas_estado_valido'
  ) then
    alter table public.reservas
      add constraint ck_reservas_estado_valido
      check (
        estado in (
          'pendiente_pago',
          'confirmada',
          'cancelada',
          'completada',
          'no_show',
          'expirada'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_reservas_precios_no_negativos'
  ) then
    alter table public.reservas
      add constraint ck_reservas_precios_no_negativos
      check (
        (precio_total is null or precio_total >= 0)
        and (anticipo_calculado is null or anticipo_calculado >= 0)
        and (saldo_pendiente is null or saldo_pendiente >= 0)
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_reservas_anticipo_no_mayor_total'
  ) then
    alter table public.reservas
      add constraint ck_reservas_anticipo_no_mayor_total
      check (
        precio_total is null
        or anticipo_calculado is null
        or anticipo_calculado <= precio_total
      );
  end if;
end $$;

-- Invitado: al menos nombre si no hay usuario (misma idea que el insert manual)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_reservas_cliente_usuario_o_manual'
  ) then
    alter table public.reservas
      add constraint ck_reservas_cliente_usuario_o_manual
      check (
        usuario_id is not null
        or (
          cliente_manual_nombre is not null
          and length(btrim(cliente_manual_nombre)) > 0
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'excl_reservas_no_solape_activas'
  ) then
    begin
      alter table public.reservas
        add constraint excl_reservas_no_solape_activas
        exclude using gist (
          negocio_id with =,
          tstzrange(inicio_en, fin_en, '[)') with &&
        )
        where (estado is distinct from 'cancelada');
    exception
      when others then
        raise warning
          'No se creó excl_reservas_no_solape_activas (¿solapes en reservas?): %',
          sqlerrm;
    end;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Trigger: reserva no debe solapar bloqueos (mismo negocio), salvo cancelada
-- -----------------------------------------------------------------------------
create or replace function public.trg_reservas_no_solapar_bloqueos()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.estado is not distinct from 'cancelada' then
    return new;
  end if;

  if exists (
    select 1
    from public.bloqueos b
    where b.negocio_id = new.negocio_id
      and tstzrange(new.inicio_en, new.fin_en, '[)')
          && tstzrange(b.inicio_en, b.fin_en, '[)')
  ) then
    raise exception 'La reserva se solapa con un bloqueo del negocio'
      using errcode = '23514'; -- check_violation
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reservas_bloqueos_biud on public.reservas;

create trigger trg_reservas_bloqueos_biud
  before insert or update of inicio_en, fin_en, negocio_id, estado
  on public.reservas
  for each row
  execute function public.trg_reservas_no_solapar_bloqueos();

-- -----------------------------------------------------------------------------
-- servicios (validaciones createServicio / updateServicio)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_servicios_duracion_positiva'
  ) then
    alter table public.servicios
      add constraint ck_servicios_duracion_positiva
      check (duracion_min is null or duracion_min > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_servicios_precio_nonneg'
  ) then
    alter table public.servicios
      add constraint ck_servicios_precio_nonneg
      check (precio is null or precio >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_servicios_anticipo_tipo'
  ) then
    alter table public.servicios
      add constraint ck_servicios_anticipo_tipo
      check (
        anticipo_tipo is null
        or anticipo_tipo in ('fijo', 'porcentaje', 'no_requiere')
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_servicios_anticipo_valor_por_tipo'
  ) then
    alter table public.servicios
      add constraint ck_servicios_anticipo_valor_por_tipo
      check (
        anticipo_tipo is null
        or (anticipo_tipo = 'no_requiere' and anticipo_valor is null)
        or (anticipo_tipo = 'fijo' and anticipo_valor is not null and anticipo_valor > 0)
        or (
          anticipo_tipo = 'porcentaje'
          and anticipo_valor is not null
          and anticipo_valor >= 1
          and anticipo_valor <= 100
        )
      );
  end if;
end $$;

-- reserva_servicios (líneas de detalle)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_reserva_servicios_cantidad_positiva'
  ) then
    alter table public.reserva_servicios
      add constraint ck_reserva_servicios_cantidad_positiva
      check (cantidad is null or cantidad > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_reserva_servicios_precio_nonneg'
  ) then
    alter table public.reserva_servicios
      add constraint ck_reserva_servicios_precio_nonneg
      check (precio is null or precio >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_reserva_servicios_anticipo_nonneg'
  ) then
    alter table public.reserva_servicios
      add constraint ck_reserva_servicios_anticipo_nonneg
      check (anticipo_calculado is null or anticipo_calculado >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_reserva_servicios_duracion_positiva'
  ) then
    alter table public.reserva_servicios
      add constraint ck_reserva_servicios_duracion_positiva
      check (duracion_min is null or duracion_min > 0);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- pagos (solo si existe la tabla public.pagos)
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.pagos') is not null then
    if not exists (
      select 1 from pg_constraint where conname = 'ck_pagos_estado_valido'
    ) then
      alter table public.pagos
        add constraint ck_pagos_estado_valido
        check (
          estado in (
            'creado',
            'pendiente',
            'pagado',
            'fallido',
            'cancelado',
            'reembolsado'
          )
        );
    end if;
  end if;
end $$;
