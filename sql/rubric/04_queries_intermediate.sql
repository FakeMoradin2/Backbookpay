-- =============================================================================
-- Rúbrica: 20 consultas intermedias (JOIN, GROUP BY + HAVING, subconsultas escalares)
-- =============================================================================

-- I01: INNER JOIN negocio–servicio
SELECT n.nombre AS negocio, s.nombre AS servicio, s.precio
FROM public.negocios n
JOIN public.servicios s ON s.negocio_id = n.id
WHERE n.activo = true AND s.activo = true
ORDER BY n.nombre, s.nombre
LIMIT 50;

-- I02: LEFT JOIN reservas sin pago registrado
SELECT r.id, r.inicio_en, r.estado, p.id AS pago_id
FROM public.reservas r
LEFT JOIN public.pagos p ON p.reserva_id = r.id
WHERE p.id IS NULL
LIMIT 50;

-- I03: RIGHT JOIN (equivalente práctico: invertir tablas pequeñas)
SELECT s.id, n.nombre
FROM public.servicios s
RIGHT JOIN public.negocios n ON n.id = s.negocio_id
WHERE n.activo = true
LIMIT 50;

-- I04: JOIN múltiple reserva → negocio → servicios línea
SELECT r.id, n.nombre, rs.servicio_id, rs.precio
FROM public.reservas r
JOIN public.negocios n ON n.id = r.negocio_id
JOIN public.reserva_servicios rs ON rs.reserva_id = r.id
LIMIT 100;

-- I05: GROUP BY negocio, COUNT servicios
SELECT n.id, n.nombre, COUNT(s.id) AS num_servicios
FROM public.negocios n
LEFT JOIN public.servicios s ON s.negocio_id = n.id AND s.activo = true
GROUP BY n.id, n.nombre
HAVING COUNT(s.id) >= 1
ORDER BY num_servicios DESC
LIMIT 30;

-- I06: HAVING sobre reservas por estado
SELECT negocio_id, estado, COUNT(*) AS c
FROM public.reservas
GROUP BY negocio_id, estado
HAVING COUNT(*) > 0
ORDER BY c DESC;

-- I07: Subconsulta escalar: precio máximo global
SELECT id, nombre, precio
FROM public.servicios
WHERE precio = (SELECT MAX(precio) FROM public.servicios);

-- I08: Subconsulta escalar en SELECT
SELECT nombre, (SELECT COUNT(*) FROM public.servicios s WHERE s.negocio_id = n.id) AS total_srv
FROM public.negocios n
LIMIT 20;

-- I09: IN con subconsulta
SELECT * FROM public.reservas
WHERE negocio_id IN (SELECT id FROM public.negocios WHERE activo = true)
LIMIT 50;

-- I10: EXISTS
SELECT n.id, n.nombre
FROM public.negocios n
WHERE EXISTS (SELECT 1 FROM public.horarios h WHERE h.negocio_id = n.id AND h.activo = true);

-- I11: NOT EXISTS
SELECT n.id FROM public.negocios n
WHERE NOT EXISTS (SELECT 1 FROM public.bloqueos b WHERE b.negocio_id = n.id)
LIMIT 30;

-- I12: GROUP BY fecha (cast)
SELECT inicio_en::date AS dia, COUNT(*) AS reservas_dia
FROM public.reservas
GROUP BY inicio_en::date
HAVING COUNT(*) >= 1
ORDER BY dia DESC
LIMIT 14;

-- I13: JOIN + filtro agregado (subconsulta)
SELECT * FROM public.negocios n
WHERE n.id IN (
  SELECT negocio_id FROM public.reservas GROUP BY negocio_id HAVING COUNT(*) > 3
);

-- I14: LEFT JOIN horarios por negocio
SELECT n.nombre, h.dia_semana, h.hora_inicio, h.hora_fin
FROM public.negocios n
LEFT JOIN public.horarios h ON h.negocio_id = n.id AND h.activo = true
ORDER BY n.nombre
LIMIT 80;

-- I15: SUM con JOIN
SELECT n.nombre, COALESCE(SUM(r.precio_total), 0)::numeric(14,2) AS volumen
FROM public.negocios n
LEFT JOIN public.reservas r ON r.negocio_id = n.id
GROUP BY n.id, n.nombre
HAVING COALESCE(SUM(r.precio_total), 0) > 0
ORDER BY volumen DESC
LIMIT 20;

-- I16: Subconsulta correlacionada mínimo precio por negocio
SELECT s.id, s.nombre, s.precio, s.negocio_id
FROM public.servicios s
WHERE s.precio = (
  SELECT MIN(s2.precio) FROM public.servicios s2 WHERE s2.negocio_id = s.negocio_id
);

-- I17: UNION ALL dos orígenes de eventos (reservas + bloqueos)
SELECT 'reserva' AS tipo, inicio_en AS t FROM public.reservas
UNION ALL
SELECT 'bloqueo', inicio_en FROM public.bloqueos
ORDER BY t DESC
LIMIT 40;

-- I18: GROUP BY + CASE
SELECT
  CASE WHEN precio < 100 THEN 'economico' WHEN precio < 300 THEN 'medio' ELSE 'alto' END AS tramo,
  COUNT(*) AS n
FROM public.servicios
GROUP BY 1
ORDER BY n DESC;

-- I19: HAVING AVG
SELECT negocio_id, AVG(precio)::numeric(12,2) AS avg_precio
FROM public.servicios
GROUP BY negocio_id
HAVING AVG(precio) > 0
ORDER BY avg_precio DESC
LIMIT 15;

-- I20: Doble JOIN pagos–reservas–negocios
SELECT p.id, p.estado, r.inicio_en, n.nombre
FROM public.pagos p
JOIN public.reservas r ON r.id = p.reserva_id
JOIN public.negocios n ON n.id = r.negocio_id
ORDER BY p.creado_en DESC
LIMIT 50;
