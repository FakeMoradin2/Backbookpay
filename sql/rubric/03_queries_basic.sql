-- =============================================================================
-- Rúbrica: 40 consultas básicas (SELECT, WHERE, ORDER BY, LIMIT, AND/OR, LIKE, agregados)
-- =============================================================================

-- Q01–Q10: filtros y orden
-- Q01
SELECT id, nombre, activo FROM public.negocios WHERE activo = true ORDER BY nombre ASC LIMIT 20;

-- Q02
SELECT * FROM public.servicios WHERE negocio_id IS NOT NULL AND precio >= 0 ORDER BY precio DESC LIMIT 50;

-- Q03
SELECT id, inicio_en, estado FROM public.reservas WHERE estado = 'confirmada' OR estado = 'pendiente_pago';

-- Q04
SELECT nombre, correo FROM public.negocios WHERE correo IS NOT NULL AND zona_horaria = 'america/mexico_city';

-- Q05
SELECT id, duracion_min FROM public.servicios WHERE duracion_min BETWEEN 15 AND 120 ORDER BY duracion_min;

-- Q06
SELECT * FROM public.horarios WHERE activo = true AND dia_semana IN ('lun', 'mar', 'mie') ORDER BY dia_semana, hora_inicio;

-- Q07
SELECT id, motivo FROM public.bloqueos WHERE inicio_en >= now() ORDER BY inicio_en NULLS LAST LIMIT 100;

-- Q08
SELECT id, monto, estado FROM public.pagos WHERE estado <> 'cancelado' ORDER BY creado_en DESC LIMIT 30;

-- Q09
SELECT DISTINCT estado FROM public.reservas ORDER BY estado;

-- Q10
SELECT id, nombre FROM public.servicios WHERE activo = false OR activo IS NULL;

-- Q11–Q20: LIKE y patrones
-- Q11
SELECT id, nombre FROM public.negocios WHERE nombre ILIKE '%sal%' ORDER BY nombre;

-- Q12
SELECT id, descripcion FROM public.servicios WHERE descripcion LIKE '%corte%' OR descripcion LIKE '%Corte%';

-- Q13
SELECT correo FROM public.negocios WHERE correo ~ '^[a-zA-Z0-9._%+-]+@';

-- Q14
SELECT id FROM public.usuarios WHERE nombre ILIKE 'A%' ORDER BY nombre LIMIT 25;

-- Q15
SELECT id, nota FROM public.reservas WHERE nota IS NOT NULL AND nota <> '';

-- Q16
SELECT id FROM public.bloqueos WHERE motivo ILIKE '%mantenimiento%';

-- Q17
SELECT referencia FROM public.pagos WHERE referencia LIKE 'pi_%' OR referencia LIKE 'cs_%';

-- Q18
SELECT nombre FROM public.servicios WHERE nombre SIMILAR TO '(Servicio|servicio)%';

-- Q19
SELECT id, telefono FROM public.negocios WHERE telefono LIKE '+52%' ORDER BY id;

-- Q20
SELECT id FROM public.horarios WHERE dia_semana::text ~ '^(lun|mar)$';

-- Q21–Q30: agregados simples
-- Q21
SELECT COUNT(*) AS total_negocios FROM public.negocios;

-- Q22
SELECT COUNT(*) AS activos FROM public.servicios WHERE activo = true;

-- Q23
SELECT SUM(precio) AS suma_precios FROM public.servicios WHERE activo = true;

-- Q24
SELECT AVG(precio)::numeric(12,2) AS precio_promedio FROM public.servicios;

-- Q25
SELECT MIN(inicio_en) AS primera_reserva FROM public.reservas;

-- Q26
SELECT MAX(fin_en) AS ultima_reserva FROM public.reservas;

-- Q27
SELECT COUNT(DISTINCT negocio_id) AS negocios_con_servicio FROM public.servicios;

-- Q28
SELECT estado, COUNT(*) FROM public.reservas GROUP BY estado ORDER BY COUNT(*) DESC;

-- Q29
SELECT COUNT(*) FILTER (WHERE activo = true) AS activos, COUNT(*) FILTER (WHERE activo = false) AS inactivos FROM public.negocios;

-- Q30
SELECT ROUND(AVG(duracion_min::numeric), 2) AS duracion_media_min FROM public.servicios;

-- Q31–Q40: combinación lógica y límites
-- Q31
SELECT id FROM public.reservas WHERE precio_total > 0 AND (estado = 'confirmada' OR estado = 'completada') LIMIT 100;

-- Q32
SELECT id, nombre FROM public.negocios WHERE NOT (activo = false) ORDER BY creado_en DESC LIMIT 15;

-- Q33
SELECT id FROM public.reserva_servicios WHERE cantidad >= 1 AND cantidad <= 10;

-- Q34
SELECT id FROM public.pagos WHERE monto IS NULL OR monto = 0;

-- Q35
SELECT id FROM public.horarios WHERE hora_inicio < hora_fin ORDER BY negocio_id LIMIT 200;

-- Q36
SELECT COUNT(*) AS reservas_hoy FROM public.reservas WHERE inicio_en::date = CURRENT_DATE;

-- Q37
SELECT id FROM public.servicios ORDER BY creado_en DESC NULLS LAST LIMIT 5;

-- Q38
SELECT id FROM public.bloqueos WHERE fin_en > inicio_en AND motivo IS NULL;

-- Q39
SELECT SUM(anticipo_calculado)::numeric(14,2) FROM public.reservas WHERE estado IN ('pendiente_pago', 'confirmada');

-- Q40
SELECT BOOL_OR(activo) AS alguno_activo FROM public.negocios;
