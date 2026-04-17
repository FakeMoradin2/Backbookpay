# Cobertura de la rúbrica de bases de datos

| Requisito | Ubicación / evidencia |
|-----------|------------------------|
| Interconexión y drivers | `README.md` §2; comparación mysql-connector / JDBC / Eloquent vs `@supabase/supabase-js` |
| `.env`, dependencias, “pool” | `README.md` §3; `.env.example` |
| Triple entorno + API Web | `README.md` §4; REST documentada en §10 (sin GraphQL) |
| Diccionario + PK/FK | `README.md` §8 y §12 (tabla referencial) |
| Seguridad AES / BCrypt / TLS | `README.md` §12.1 |
| Normalización, ACID, MySQL vs Postgres | `README.md` §9 |
| Roles GRANT/REVOKE | `sql/rubric/01_roles_privileges.sql` |
| Seed ≥100 filas/tablas principales | `sql/rubric/02_seed_stress_test.sql` |
| 40 + 20 + 20 consultas | `03`, `04`, `05` en `sql/rubric/` |
| Vistas + EXPLAIN + índice | `sql/rubric/06_views_indexes_explain.sql` |
| UPDATE/DELETE masivos | `sql/rubric/07_maintenance_update_delete.sql` |
| Errores duplicado/FK en backend | `src/utils/postgresErrors.js` + uso en `servicios.controllers.js` |
| pg_dump / restore | `docs/BACKUPS-HA-MIGRACIONES.md` |
| HA / Multi-AZ | mismo documento |
| Migraciones (Flyway/Liquibase equivalente) | `sql/migrations/README.md` |
| MVC | `docs/MVC.md` |
