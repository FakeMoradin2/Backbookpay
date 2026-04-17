# Respaldos, alta disponibilidad y migraciones

## Respaldo y recuperación (PostgreSQL)

**Volcado lógico** (esquema + datos):

```bash
pg_dump "postgresql://USER:PASS@HOST:5432/DATABASE" \
  --format=custom \
  --file=backbooknpay_$(date +%Y%m%d).dump
```

**Solo esquema:**

```bash
pg_dump "$DATABASE_URL" --schema-only --file=schema.sql
```

**Restaurar** desde formato custom:

```bash
pg_restore --clean --if-exists --dbname="$DATABASE_URL" backbooknpay_YYYYMMDD.dump
```

Desde SQL plano:

```bash
psql "$DATABASE_URL" -f schema.sql
```

En **Supabase**: además del `pg_dump` contra la cadena de conexión del proyecto, el panel ofrece backups automáticos según el plan (documentar según tu suscripción).

## Alta disponibilidad (conceptos)

- **Réplica streaming (primary / standby):** un servidor PostgreSQL secundario aplica el WAL del primario; lecturas pueden delegarse al réplica (read replica) para escalar lecturas; el failover promueve un standby si el primario cae.
- **Multi-AZ (nube):** en AWS RDS u otros proveedores, la base se replica en zonas de disponibilidad distintas; el failover suele ser automático ante fallo de AZ. El proveedor gestiona sincronización y DNS.
- **Supabase:** la infraestructura gestionada abstrae réplicas y backups; para la entrega académica basta explicar el modelo y citar la documentación del proveedor.

## Migraciones

Este repositorio usa **scripts SQL versionados** en `sql/` con prefijo de fecha (`2026-03-25-...`), estilo **Flyway/Liquibase manual**: orden conocido, sin herramienta Java embebida.

Para equipos que requieran herramienta explícita:

- **Flyway** / **Liquibase:** apuntar al mismo esquema `public` y convertir cada `.sql` en una migración versionada.
- **Sequelize / TypeORM:** orientados a Node; encajan si se introduce un ORM (hoy el acceso es vía Supabase JS).

Ver también `sql/migrations/README.md`.
