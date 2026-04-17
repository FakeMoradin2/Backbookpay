-- =============================================================================
-- Rúbrica: 20 consultas avanzadas — CTE, funciones de ventana, recursivas, transacciones
-- =============================================================================

-- A01: CTE simple
WITH activos AS (
  SELECT id, nombre FROM public.negocios WHERE activo = true
)
SELECT * FROM activos ORDER BY nombre LIMIT 20;

-- A02: CTE encadenada (precios por negocio)
WITH precios AS (
  SELECT negocio_id, AVG(precio)::numeric(12,2) AS avg_p FROM public.servicios GROUP BY negocio_id
)
SELECT n.nombre, p.avg_p
FROM public.negocios n
JOIN precios p ON p.negocio_id = n.id
ORDER BY p.avg_p DESC NULLS LAST
LIMIT 15;

-- A03: CTE + filtro posterior
WITH r AS (SELECT id, negocio_id, precio_total FROM public.reservas WHERE estado = 'confirmada')
SELECT negocio_id, SUM(precio_total)::numeric(14,2) AS total FROM r GROUP BY negocio_id;

-- A04: ROW_NUMBER por negocio (servicios ordenados por precio)
SELECT * FROM (
  SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.negocio_id ORDER BY s.precio DESC) AS rn
  FROM public.servicios s
) t WHERE rn <= 3;

-- A05: RANK precio global
SELECT id, nombre, precio, RANK() OVER (ORDER BY precio DESC) AS rk
FROM public.servicios;

-- A06: DENSE_RANK
SELECT id, inicio_en, DENSE_RANK() OVER (ORDER BY inicio_en::date) AS dr
FROM public.reservas;

-- A07: SUM ventana acumulada (por fecha)
SELECT inicio_en::date AS d, COUNT(*) AS c,
  SUM(COUNT(*)) OVER (ORDER BY inicio_en::date) AS acum
FROM public.reservas
GROUP BY inicio_en::date
ORDER BY d;

-- A08: LAG precio anterior mismo negocio
SELECT id, negocio_id, precio,
  LAG(precio) OVER (PARTITION BY negocio_id ORDER BY creado_en) AS precio_ant
FROM public.servicios;

-- A09: LEAD
SELECT id, inicio_en, LEAD(inicio_en) OVER (ORDER BY inicio_en) AS siguiente
FROM public.reservas;

-- A10: NTILE buckets
SELECT id, precio, NTILE(4) OVER (ORDER BY precio) AS cuartil
FROM public.servicios;

-- A11: FIRST_VALUE en partición
SELECT DISTINCT negocio_id,
  FIRST_VALUE(nombre) OVER (PARTITION BY negocio_id ORDER BY precio DESC) AS srv_caro
FROM public.servicios;

-- A12: Consulta recursiva — contador 1..8 (demostración de sintaxis WITH RECURSIVE)
WITH RECURSIVE serie AS (
  SELECT 1 AS n
  UNION ALL
  SELECT n + 1 FROM serie WHERE n < 8
)
SELECT * FROM serie;

-- A13: Recursiva — suma de enteros 1..n (árbol lineal)
WITH RECURSIVE suma(n, total) AS (
  SELECT 1, 1
  UNION ALL
  SELECT n + 1, total + (n + 1) FROM suma WHERE n < 10
)
SELECT * FROM suma ORDER BY n DESC LIMIT 1;

-- A14: Recursiva — fechas +7 días (jerarquía temporal simple)
WITH RECURSIVE fechas(d) AS (
  SELECT CURRENT_DATE
  UNION ALL
  SELECT d + 7 FROM fechas WHERE d < CURRENT_DATE + 70
)
SELECT * FROM fechas;

-- A15: Transacción explícita — insertar y confirmar (tabla temporal de sesión)
BEGIN;
CREATE TEMP TABLE IF NOT EXISTS rubric_tmp_demo (id int PRIMARY KEY, txt text);
INSERT INTO rubric_tmp_demo VALUES (1, 'tx_ok') ON CONFLICT (id) DO UPDATE SET txt = EXCLUDED.txt;
SELECT * FROM rubric_tmp_demo;
COMMIT;

-- A16: Transacción con ROLLBACK
BEGIN;
CREATE TEMP TABLE IF NOT EXISTS rubric_tmp_roll (k int);
INSERT INTO rubric_tmp_roll VALUES (1);
ROLLBACK;

-- A17: CTE múltiples y ventana combinadas
WITH base AS (
  SELECT r.id, r.negocio_id, r.precio_total,
    ROW_NUMBER() OVER (PARTITION BY r.negocio_id ORDER BY r.inicio_en DESC) AS rn
  FROM public.reservas r
)
SELECT * FROM base WHERE rn = 1;

-- A18: PERCENT_RANK
SELECT id, precio, PERCENT_RANK() OVER (ORDER BY precio) AS pct
FROM public.servicios;

-- A19: CUME_DIST
SELECT id, inicio_en, CUME_DIST() OVER (PARTITION BY negocio_id ORDER BY inicio_en) AS cd
FROM public.reservas;

-- A20: Subconsulta + CTE materializada (simulación reporte)
WITH snap AS MATERIALIZED (
  SELECT negocio_id, COUNT(*) AS nres FROM public.reservas GROUP BY negocio_id
)
SELECT n.nombre, snap.nres
FROM snap
JOIN public.negocios n ON n.id = snap.negocio_id
ORDER BY snap.nres DESC
LIMIT 10;
