-- =============================================================================
-- Rúbrica: mantenimiento — UPDATE masivos y DELETE controlados
-- Verificar integridad referencial (ON DELETE / restricciones) en entorno de prueba.
-- =============================================================================

-- UPDATE masivo: desactivar servicios sin precio en rango (ejemplo académico)
BEGIN;
UPDATE public.servicios
SET activo = false
WHERE activo = true
  AND precio < 1
  AND id IN (SELECT id FROM public.servicios LIMIT 500);
-- Revisar filas afectadas antes de confirmar
-- ROLLBACK;  -- deshacer en ensayo
COMMIT;

-- UPDATE masivo con JOIN: ajustar buffer por defecto en servicios de un negocio
BEGIN;
UPDATE public.servicios s
SET buffer_min = 5
FROM public.negocios n
WHERE s.negocio_id = n.id
  AND n.zona_horaria = 'america/mexico_city'
  AND s.buffer_min = 0;
COMMIT;

-- DELETE controlado: eliminar líneas de detalle huérfanas (si existieran en pruebas)
-- (En producción usar con precaución; aquí solo patrón de transacción)
BEGIN;
DELETE FROM public.reserva_servicios rs
WHERE NOT EXISTS (
  SELECT 1 FROM public.reservas r WHERE r.id = rs.reserva_id
);
ROLLBACK; -- por seguridad por defecto no borrar en script desatendido; cambiar a COMMIT si aplica

-- DELETE en cascada lógica: borrar pagos de reservas canceladas (ejemplo)
BEGIN;
DELETE FROM public.pagos p
USING public.reservas r
WHERE p.reserva_id = r.id AND r.estado = 'cancelada';
-- COMMIT;

-- Comprobar violación FK: intento inválido (debe fallar con error 23503)
-- Descomentar para demostración:
-- DELETE FROM public.negocios WHERE id = (SELECT negocio_id FROM public.servicios LIMIT 1);
