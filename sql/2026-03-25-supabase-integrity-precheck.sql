-- =============================================================================
-- PRE-CHEQUEO (solo lectura): solapes que impiden EXCLUDE en horarios / reservas
-- Ejecutar ANTES de 2026-03-25-supabase-integrity-constraints.sql
-- Corrige o elimina filas conflictivas; luego vuelve a ejecutar el script principal.
-- =============================================================================

-- Horarios activos que se traslapen (misma lógica que el backend haySolapamiento)
with h as (
  select
    id,
    negocio_id,
    dia_semana,
    hora_inicio,
    hora_fin,
    activo,
    (
      extract(hour from hora_inicio::time)::int * 60
      + extract(minute from hora_inicio::time)::int
    ) as m0,
    (
      extract(hour from hora_fin::time)::int * 60
      + extract(minute from hora_fin::time)::int
    ) as m1
  from public.horarios
  where activo = true
)
select
  h1.id as horario_id_a,
  h2.id as horario_id_b,
  h1.negocio_id,
  h1.dia_semana::text as dia_semana,
  h1.hora_inicio as inicio_a,
  h1.hora_fin as fin_a,
  h2.hora_inicio as inicio_b,
  h2.hora_fin as fin_b
from h h1
join h h2
  on h1.negocio_id = h2.negocio_id
  and h1.dia_semana = h2.dia_semana
  and h1.id < h2.id
where int4range(h1.m0, h1.m1, '[)') && int4range(h2.m0, h2.m1, '[)')
order by h1.negocio_id, h1.dia_semana::text;

-- Reservas no canceladas que se traslapen (mismo negocio)
select
  r1.id as reserva_id_a,
  r2.id as reserva_id_b,
  r1.negocio_id,
  r1.estado as estado_a,
  r2.estado as estado_b,
  r1.inicio_en as inicio_a,
  r1.fin_en as fin_a,
  r2.inicio_en as inicio_b,
  r2.fin_en as fin_b
from public.reservas r1
join public.reservas r2
  on r1.negocio_id = r2.negocio_id
  and r1.id < r2.id
where r1.estado is distinct from 'cancelada'
  and r2.estado is distinct from 'cancelada'
  and tstzrange(r1.inicio_en, r1.fin_en, '[)')
      && tstzrange(r2.inicio_en, r2.fin_en, '[)')
order by r1.negocio_id, r1.inicio_en;
