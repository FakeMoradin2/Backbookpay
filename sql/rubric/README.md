# Scripts de rúbrica (PostgreSQL / Supabase)

Esta carpeta agrupa entregables académicos: **roles y privilegios**, **carga masiva (stress)**, **consultas por nivel**, **vistas e índices con EXPLAIN**, y **mantenimiento DML**.

## Orden de ejecución recomendado

| Orden | Archivo | Contenido |
|------|---------|-----------|
| 1 | `01_roles_privileges.sql` | `CREATE ROLE` / usuarios de login / `GRANT` / `REVOKE` |
| 2 | `02_seed_stress_test.sql` | Inserción masiva (marcada `Stress Seed` para borrado) |
| 3 | `03_queries_basic.sql` | 40 consultas básicas |
| 4 | `04_queries_intermediate.sql` | 20 consultas con JOIN, GROUP BY, subconsultas |
| 5 | `05_queries_advanced.sql` | 20 consultas: CTE, ventana, recursivas, transacciones |
| 6 | `06_views_indexes_explain.sql` | Vistas de reporte + `EXPLAIN (ANALYZE)` e índices |
| 7 | `07_maintenance_update_delete.sql` | UPDATE masivo y DELETE controlado |

## Supabase y roles

En **Supabase** (hosted), crear roles y usuarios SQL puede requerir permisos de superusuario según el plan. Opciones:

- Ejecutar `01_roles_privileges.sql` en una instancia **PostgreSQL local** o en un rol con privilegios suficientes.
- En Supabase: **SQL Editor** como usuario con permisos; si algún `CREATE ROLE` falla, documentar la limitación y ejecutar el mismo script en Docker Postgres local para la demostración académica.

Los datos de **Auth** (`auth.users`) no se modifican aquí; el seed usa reservas **invitado** (`cliente_manual_*`, `usuario_id` nulo) cuando haga falta evitar FK a `usuarios`.

## Limpieza del seed de estrés

El script `02_seed_stress_test.sql` marca filas con nombres/patrones identificables. Incluye comentarios al final para `DELETE` en orden seguro (hijos → padres) sobre esos datos de prueba.
