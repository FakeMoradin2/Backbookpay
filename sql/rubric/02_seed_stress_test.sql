-- =============================================================================
-- Rúbrica: seed / carga de estrés (≥100 filas por tabla principal de negocio)
-- Prefijo identificable: "Stress Seed" / "Cliente Stress"
-- Ejecutar solo en entorno de pruebas. Revisar enums (anticipo_tipo, estado, etc.)
-- =============================================================================

-- Ajustar si tu esquema difiere (extensiones)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Negocios (100)
-- ---------------------------------------------------------------------------
INSERT INTO public.negocios (
  nombre,
  telefono,
  correo,
  zona_horaria,
  duracion_buffer_min,
  activo,
  creado_en
)
SELECT
  'Stress Seed Negocio ' || gs::text,
  '+5255' || lpad((10000000 + gs)::text, 8, '0'),
  'stress.seed.' || gs || '@loadtest.invalid',
  'america/mexico_city',
  10,
  true,
  now() - (gs || ' minutes')::interval
FROM generate_series(1, 100) AS gs;

-- ---------------------------------------------------------------------------
-- 2) Servicios (120) — reparto sobre negocios de stress
-- ---------------------------------------------------------------------------
INSERT INTO public.servicios (
  negocio_id,
  nombre,
  descripcion,
  duracion_min,
  buffer_min,
  precio,
  anticipo_tipo,
  anticipo_valor,
  activo,
  creado_en
)
SELECT
  n.id,
  'Servicio stress ' || row_number() OVER (),
  'Generado para pruebas de carga',
  30,
  0,
  (random() * 200 + 50)::numeric(12, 2),
  'no_requiere',
  NULL,
  true,
  now()
FROM (
  SELECT id
  FROM public.negocios
  WHERE nombre LIKE 'Stress Seed Negocio%'
  ORDER BY creado_en DESC
  LIMIT 100
) AS n
CROSS JOIN generate_series(1, 2) AS g
LIMIT 120;

-- ---------------------------------------------------------------------------
-- 3) Horarios (100) — un bloque lun 09–18 por los primeros 100 negocios stress
-- ---------------------------------------------------------------------------
INSERT INTO public.horarios (
  negocio_id,
  dia_semana,
  hora_inicio,
  hora_fin,
  activo,
  creado_en
)
SELECT
  n.id,
  'lun',
  time '09:00',
  time '18:00',
  true,
  now()
FROM (
  SELECT id
  FROM public.negocios
  WHERE nombre LIKE 'Stress Seed Negocio%'
  ORDER BY id
  LIMIT 100
) AS n;

-- ---------------------------------------------------------------------------
-- 4) Bloqueos (100) — ventanas en 2030 (no solapan reservas de 2027)
-- ---------------------------------------------------------------------------
INSERT INTO public.bloqueos (
  negocio_id,
  inicio_en,
  fin_en,
  motivo,
  creado_en
)
SELECT
  n.id,
  timestamptz '2030-01-01 00:00:00+00' + (row_number() OVER () || ' hours')::interval,
  timestamptz '2030-01-01 02:00:00+00' + (row_number() OVER () || ' hours')::interval,
  'Stress seed bloqueo',
  now()
FROM (
  SELECT id
  FROM public.negocios
  WHERE nombre LIKE 'Stress Seed Negocio%'
  ORDER BY id
  LIMIT 100
) AS n;

-- ---------------------------------------------------------------------------
-- 5) Reservas (100) — invitado (sin usuario_id), una por negocio stress
-- ---------------------------------------------------------------------------
INSERT INTO public.reservas (
  negocio_id,
  usuario_id,
  staff_id,
  inicio_en,
  fin_en,
  estado,
  precio_total,
  anticipo_calculado,
  saldo_pendiente,
  nota,
  cliente_manual_nombre,
  cliente_manual_correo,
  creado_en
)
SELECT
  nb.id,
  NULL,
  NULL,
  timestamptz '2027-06-15 14:00:00+00' + (gs || ' hours')::interval,
  timestamptz '2027-06-15 15:00:00+00' + (gs || ' hours')::interval,
  'confirmada',
  150.00,
  0,
  150.00,
  'Seed estrés',
  'Cliente Stress ' || gs,
  'cliente' || gs || '@seed.invalid',
  now()
FROM generate_series(1, 100) AS gs
JOIN (
  SELECT id, row_number() OVER (ORDER BY id) AS rn
  FROM public.negocios
  WHERE nombre LIKE 'Stress Seed Negocio%'
) AS nb ON nb.rn = gs;

-- ---------------------------------------------------------------------------
-- 6) Líneas de reserva (100) — un detalle por reserva stress
-- ---------------------------------------------------------------------------
INSERT INTO public.reserva_servicios (
  reserva_id,
  servicio_id,
  cantidad,
  duracion_min,
  precio,
  anticipo_calculado,
  creado_en
)
SELECT DISTINCT ON (r.id)
  r.id,
  s.id,
  1,
  30,
  150.00,
  0,
  now()
FROM public.reservas r
JOIN public.negocios n ON n.id = r.negocio_id
JOIN public.servicios s ON s.negocio_id = n.id
WHERE r.cliente_manual_nombre LIKE 'Cliente Stress%'
ORDER BY r.id, s.id;

-- ---------------------------------------------------------------------------
-- 7) Pagos (100) — estado inicial "creado"
-- ---------------------------------------------------------------------------
INSERT INTO public.pagos (
  reserva_id,
  tipo,
  monto,
  moneda,
  metodo,
  estado,
  referencia,
  creado_en
)
SELECT
  r.id,
  'anticipo',
  0,
  'mxn',
  'stripe',
  'creado',
  'seed-ref-' || r.id::text,
  now()
FROM public.reservas r
WHERE r.cliente_manual_nombre LIKE 'Cliente Stress%';

-- =============================================================================
-- Limpieza manual (orden: hijos → padres). Descomentar solo para borrar el seed.
-- =============================================================================
-- DELETE FROM public.pagos WHERE referencia LIKE 'seed-ref-%';
-- DELETE FROM public.reserva_servicios WHERE reserva_id IN (
--   SELECT id FROM public.reservas WHERE cliente_manual_nombre LIKE 'Cliente Stress%'
-- );
-- DELETE FROM public.reservas WHERE cliente_manual_nombre LIKE 'Cliente Stress%';
-- DELETE FROM public.bloqueos WHERE motivo = 'Stress seed bloqueo';
-- DELETE FROM public.horarios WHERE negocio_id IN (
--   SELECT id FROM public.negocios WHERE nombre LIKE 'Stress Seed Negocio%'
-- );
-- DELETE FROM public.servicios WHERE descripcion = 'Generado para pruebas de carga';
-- DELETE FROM public.negocios WHERE nombre LIKE 'Stress Seed Negocio%';
