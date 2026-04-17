-- =============================================================================
-- Rúbrica: vistas de reporte + índices + EXPLAIN (ANALYZE)
-- Ejecutar en base con datos representativos; volver a ANALYZE tras cargas masivas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Vistas para reportes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_reporte_reservas_negocio AS
SELECT
  n.id AS negocio_id,
  n.nombre AS negocio,
  COUNT(r.id) AS total_reservas,
  COALESCE(SUM(r.precio_total), 0)::numeric(14, 2) AS volumen_total,
  COALESCE(AVG(r.precio_total), 0)::numeric(14, 2) AS ticket_promedio
FROM public.negocios n
LEFT JOIN public.reservas r ON r.negocio_id = n.id
GROUP BY n.id, n.nombre;

CREATE OR REPLACE VIEW public.v_servicios_activos_por_negocio AS
SELECT
  n.nombre AS negocio,
  s.id AS servicio_id,
  s.nombre AS servicio,
  s.precio,
  s.duracion_min,
  s.anticipo_tipo
FROM public.servicios s
JOIN public.negocios n ON n.id = s.negocio_id
WHERE s.activo = true AND n.activo = true;

-- ---------------------------------------------------------------------------
-- Índice de demostración (B-Tree por defecto en PostgreSQL)
-- Ajustar nombre si ya existe en tu proyecto.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_rubric_reservas_negocio_inicio;
CREATE INDEX idx_rubric_reservas_negocio_inicio
  ON public.reservas (negocio_id, inicio_en);

-- ---------------------------------------------------------------------------
-- EXPLAIN: comparar plan antes (sin índice útil) vs después
-- Nota: deshabilitar temporalmente el índice para ver Seq Scan (solo demo local):
--   BEGIN; SET LOCAL enable_indexscan = off; EXPLAIN ANALYZE ... ROLLBACK;
-- En la práctica, comparar EXPLAIN de la misma consulta antes/después de CREATE INDEX.
-- ---------------------------------------------------------------------------

-- Consulta típica “lenta” sin índice adecuado: filtro por negocio + rango de fechas
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, estado, precio_total
FROM public.reservas
WHERE negocio_id = (SELECT id FROM public.negocios WHERE activo = true LIMIT 1)
  AND inicio_en >= now() - interval '365 days'
ORDER BY inicio_en;

-- Misma consulta tras crear idx_rubric_reservas_negocio_inicio — debe favorecer Index Scan / Bitmap Index Scan
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, estado, precio_total
FROM public.reservas
WHERE negocio_id = (SELECT id FROM public.negocios WHERE activo = true LIMIT 1)
  AND inicio_en >= now() - interval '365 days'
ORDER BY inicio_en;
