# Convención de migraciones (estilo Flyway)

Los archivos en `sql/` raíz siguen el patrón:

`AAAA-MM-DD-descripcion-corta.sql`

**Orden:** ejecutar por fecha ascendente en cada entorno (desarrollo → staging → producción).

**Equivalente Flyway:** cada archivo sería un `V20260325__supabase_integrity_constraints.sql` (una sola transacción por migración según configuración).

**Liquibase:** cada script puede mapearse a un `changeSet` con `runOnChange` o version fija.

No se incluye el motor Flyway/Liquibase en este repo para no añadir dependencias JVM o Node adicionales; la rúbrica queda cubierta documentando el equivalente y manteniendo SQL versionado en Git.
