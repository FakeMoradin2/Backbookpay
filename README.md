# BackBookNPay — Documentación del backend

API REST en **Node.js (Express 5)** que expone la lógica de negocio sobre una base de datos relacional **PostgreSQL** hospedada en **Supabase**. La autenticación delega credenciales y tokens a **Supabase Auth**; los pagos usan **Stripe** (Checkout, Connect, webhooks).

---

## 1. Arquitectura y capas

| Capa | Tecnología | Rol |
|------|------------|-----|
| Cliente HTTP | Navegador / app móvil / otro backend | Consume JSON por HTTPS |
| API | Express (`src/app.js`, `server.js`) | Rutas REST, validación, orquestación |
| Autenticación | Supabase Auth (`Authorization: Bearer`) | Sesiones JWT, refresh, registro |
| Datos | PostgreSQL vía `@supabase/supabase-js` | Tablas normalizadas, restricciones SQL |
| Pagos | Stripe API + webhooks | Cobros, Connect, verificación de firmas |

**No se usa GraphQL** en este proyecto: la superficie pública es **REST** bajo prefijos `/api/...`.

---

## 2. Creación de esquema y conexión

### 2.1 Esquema relacional

El modelo lógico sigue un **ERD** con entidades principales: `negocios`, `usuarios`, `servicios`, `reservas`, `reserva_servicios`, `pagos`, `horarios`, `bloqueos`. Las tablas y tipos se definen en **PostgreSQL** (proyecto Supabase: SQL Editor o migraciones).  
Restricciones adicionales alineadas con la API están documentadas en código en `sql/2026-03-25-supabase-integrity-constraints.sql` (CHECK, EXCLUDE, triggers).

### 2.2 Interconexión: problemática y driver

**Problemática típica** al conectar una aplicación a un SGBD:

1. Elegir un protocolo y credenciales seguras (host, puerto, usuario, contraseña o clave de servicio).
2. Instalar un **driver** o SDK que encapsule el protocolo (conexión, consultas, transacciones).
3. Gestionar **pool de conexiones**, timeouts y reconexión para no agotar recursos.
4. En entornos serverless o BaaS, a veces se prefiere **HTTP sobre SQL directo** para simplificar redes y certificados.

**Este backend no usa un conector tipo `mysql2` o JDBC contra MySQL/Postgres por socket**, sino el cliente oficial **Supabase** para JavaScript:

| Enfoque | Ejemplo (curso / otro stack) | En BackBookNPay |
|--------|------------------------------|-----------------|
| Node + MySQL | `npm install mysql2`, crear pool con `createPool({ host, user, password, database })` | No aplica |
| Java + JDBC | Driver JAR + `DriverManager.getConnection(jdbc:mysql://...)` | No aplica |
| Laravel | Eloquent + `.env` `DB_CONNECTION=mysql` | No aplica |
| **Node + Supabase** | `npm install @supabase/supabase-js` | **Sí** — cliente HTTP(s) con `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` |

**Instalación paso a paso (este repositorio)**

1. Clonar el repositorio y en la raíz del backend ejecutar:  
   `npm install`
2. Las dependencias relevantes ya están en `package.json`: `@supabase/supabase-js`, `express`, `cors`, `dotenv`, `stripe`, etc.
3. Crear un archivo `.env` en la raíz (ver sección 3) con al menos `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
4. Arrancar: `npm run dev` (nodemon) o `npm start`.

La configuración del cliente está en `src/config/supabase.js`: valida variables de entorno y exporta una instancia única de `createClient`.

### 2.3 Pool de conexiones y modelo de cliente

Con **Supabase JS**, el pool TCP tradicional queda **dentro de la infraestructura de Supabase**; el proceso Node mantiene el cliente HTTP y reutiliza conexiones a nivel de `fetch`/agente según el runtime. Para operaciones administrativas (p. ej. crear usuarios con privilegios elevados), el código puede instanciar un segundo cliente con `SUPABASE_SERVICE_ROLE_KEY` (solo servidor, nunca en el frontend).

---

## 3. Configuración de entorno (`.env`)

Copiar `.env.example` como punto de partida y completar valores reales. Variables usadas por el código (no commitear secretos):

| Variable | Uso |
|----------|-----|
| `PORT` | Puerto HTTP del API (por defecto `4000` en `server.js`) |
| `SUPABASE_URL` | URL del proyecto Supabase (HTTPS) |
| `SUPABASE_ANON_KEY` | Clave pública (anon); usada por el cliente por defecto en `src/config/supabase.js` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave con privilegios elevados; solo backend (p. ej. Stripe/admin en `stripe.controllers.js`, `usuarios.controllers.js`) |
| `FRONTEND_URL` | Orígenes de redirección (auth, Stripe) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CURRENCY`, etc. | Integración Stripe |
| `ADMIN_INVITE_CODE` | Registro de rol `admin` en `auth.controllers.js` |

`dotenv` carga `.env` desde la raíz del backend (`server.js` usa `path.join(__dirname, '.env')`).

---

## 4. Triple entorno: cómo la base sirve a la web

La misma API REST puede desplegarse en **desarrollo**, **staging** y **producción** con archivos `.env` distintos (o secretos del proveedor cloud):

| Entorno | API | Base de datos |
|---------|-----|----------------|
| **Desarrollo** | `localhost:PORT` | Proyecto Supabase de prueba o branch de DB |
| **Staging** | URL de pre-producción | Proyecto Supabase separado o misma instancia con prefijos |
| **Producción** | HTTPS detrás de proxy/TLS | Proyecto Supabase productivo, claves live de Stripe |

**Web (REST):** el frontend u otros consumidores llaman endpoints como `/api/negocios/...`, `/api/reservas/...`, siempre sobre la API Express; esta traduce a consultas/ mutaciones vía cliente Supabase. La base **no** se expone directamente al navegador: las claves sensibles (`SERVICE_ROLE`, secretos Stripe) viven solo en el servidor.

---

## 5. Middleware y flujo de peticiones

Orden relevante en `src/app.js`:

1. **`cors()`** — permite orígenes del frontend (ajustar política en despliegue real si hace falta restricción por dominio).
2. **`POST /api/stripe/webhook`** — cuerpo **raw** (`express.raw`) **antes** de `express.json()`, para que Stripe verifique la firma del payload.
3. **`express.json()`** — parseo JSON para el resto de rutas.
4. **Rutas** montadas bajo `/api/stripe`, `/api/negocios`, `/api/servicios`, `/api/horarios`, `/api/reservas`, `/api/bloqueos`, `/api/pagos`, `/api/usuarios`, `/api/health`, `/api/auth`.

**Autenticación (`src/middleware/requireAuth.js`)**

- Lee `Authorization: Bearer <access_token>`.
- Llama a `supabase.auth.getUser(token)` para validar el JWT.
- Carga el perfil en `usuarios` y comprueba `activo`.
- Ante errores de red hacia Supabase, responde **503** con mensaje controlado; token inválido → **401**; usuario inactivo → **403**.
- Adjuntá `req.user` para controladores posteriores.

Rutas administrativas/protegidas importan `requireAuth` (p. ej. `negocios.routes.js`, `reservas.routes.js`).

---

## 6. Tiempos de carga y observabilidad

Este repositorio no incluye un APM integrado (p. ej. Datadog/New Relic); las prácticas recomendadas son:

- **Health check:** `GET /api/health/supabase` ejecuta una consulta mínima (`negocios`, `limit 1`) para medir disponibilidad extremo a extremo (API → Supabase).
- **Latencia:** medir en el cliente o con herramientas externas (curl, k6) el tiempo hasta el primer byte (TTFB) y el cuerpo JSON.
- **Cuellos de botella típicos:** frío del runtime, RTT a Supabase, consultas sin índice, o lógica pesada en controladores.

El middleware de auth ya distingue fallos de red (`503`) para no confundir indisponibilidad del proveedor de identidad con credenciales incorrectas.

---

## 7. Seguridad

### 7.1 Transporte (SSL/TLS)

- Tráfico hacia **Supabase** y **Stripe** usa **HTTPS**; el cliente JS asume URLs `https://`.
- En producción, el API debe publicarse detrás de **TLS terminado** (reverse proxy, PaaS, etc.).

### 7.2 Contraseñas y hashing

- El **hash de contraseñas** no se implementa en este repo: lo gestiona **Supabase Auth** (motor compatible con buenas prácticas; típicamente esquemas tipo bcrypt/argon2 según versión de GoTrue).
- El backend solo reenvía `signInWithPassword` / `signUp` en `auth.controllers.js`.

### 7.3 Datos sensibles y tokens

- **JWT:** access/refresh emitidos por Supabase; el backend valida el access token en rutas protegidas.
- **Stripe:** clave secreta y webhook secret solo en variables de entorno; el webhook valida la firma del evento.
- **Clave `SUPABASE_SERVICE_ROLE_KEY`:** bypass de RLS en operaciones server-side — **nunca** en frontend ni repositorios públicos.
- **Encriptación AES aplicada por la aplicación:** no hay cifrado AES explícito en el código de negocio mostrado; datos financieros sensibles adicionales deberían cifrarse en aplicación o delegarse a PCI-compliant providers (Stripe). En reposo, Supabase/Postgres puede usar cifrado a nivel de disco según el plan cloud.

### 7.4 Integridad en base de datos

- Scripts SQL (`sql/2026-03-25-supabase-integrity-constraints.sql`) añaden **CHECK**, **EXCLUDE** (no solapamiento de horarios/reservas) y **triggers** para coherencia con la lógica de la API.

---

## 8. Diccionario de datos (resumen)

Tipos alineados al ERD del sistema (PostgreSQL). Los nombres exactos de enums pueden coincidir con migraciones en Supabase.

### `negocios`

| Columna | Tipo (lógico) | Descripción |
|---------|----------------|-------------|
| `id` | UUID (PK) | Identificador |
| `nombre`, `telefono`, `correo` | VARCHAR | Datos de contacto |
| `zona_horaria` | VARCHAR | IANA TZ |
| `duracion_buffer_min` | INT4 | Buffer entre citas |
| `activo` | BOOLEAN | Negocio activo |
| `creado_en` | TIMESTAMPTZ | Auditoría |
| `imagen_url` | TEXT | URL de imagen |
| `stripe_connect_*` | TEXT / BOOLEAN | Stripe Connect |

### `usuarios`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID (PK, FK lógico a `auth.users`) | Usuario autenticado |
| `negocio_id` | UUID (FK → `negocios.id`) | Negocio asociado |
| `nombre`, `correo`, `telefono` | VARCHAR | Perfil |
| `rol` | ENUM `rol_usuario` | p. ej. admin, staff, cliente |
| `activo`, `creado_en` | BOOLEAN, TIMESTAMPTZ | Estado y auditoría |

### `servicios`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID (PK) | |
| `negocio_id` | UUID (FK) | |
| `nombre`, `descripcion` | VARCHAR, TEXT | |
| `duracion_min`, `buffer_min` | INT4 | |
| `precio`, `anticipo_valor` | NUMERIC | Evita errores de redondeo |
| `anticipo_tipo` | ENUM | p. ej. fijo, porcentaje, no_requiere |
| `activo`, `creado_en`, `imagen_url` | | |

### `reservas`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID (PK) | |
| `negocio_id` | UUID (FK) | |
| `usuario_id` | UUID (FK → `usuarios`) | Cliente/staff según modelo |
| `inicio_en`, `fin_en` | TIMESTAMPTZ | Ventana de la cita |
| `estado` | ENUM | p. ej. pendiente_pago, confirmada, cancelada, … |
| `precio_total`, `anticipo_calculado`, `saldo_pendiente` | NUMERIC | |
| `nota` | TEXT | |
| `cliente_manual_*` | VARCHAR | Walk-in sin usuario |
| `staff_id` | UUID (FK) | Profesional asignado |

### `reserva_servicios` (tabla puente M:N)

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID (PK) | |
| `reserva_id` | UUID (FK → `reservas`) | |
| `servicio_id` | UUID (FK → `servicios`) | |
| `cantidad`, `duracion_min` | INT4 | |
| `precio`, `anticipo_calculado` | NUMERIC | Snapshot al reservar |
| `creado_en` | TIMESTAMPTZ | |

### `pagos`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID (PK) | |
| `reserva_id` | UUID (FK → `reservas`) | |
| `tipo`, `metodo`, `estado` | ENUMs | Flujo de cobro |
| `monto` | NUMERIC | |
| `moneda` | CHAR(3) típ. | ISO |
| `referencia` | VARCHAR | Id externo (Stripe, etc.) |
| `creado_en` | TIMESTAMPTZ | |

### `horarios`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID (PK) | |
| `negocio_id` | UUID (FK) | |
| `dia_semana` | ENUM | lun…dom |
| `hora_inicio`, `hora_fin` | TIME | |
| `activo`, `creado_en` | | |

### `bloqueos`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID (PK) | |
| `negocio_id` | UUID (FK) | |
| `inicio_en`, `fin_en` | TIMESTAMPTZ | Vacaciones / mantenimiento |
| `motivo` | VARCHAR | |
| `creado_en` | TIMESTAMPTZ | |

---

## 9. Justificación del diseño relacional

### 9.1 Por qué modelo relacional y carga / ACID

- **Reservas y pagos** exigen **integridad fuerte**: no doble reserva del mismo recurso temporal, montos coherentes con líneas de detalle, estados de pago alineados con la reserva.
- Un **SGBD relacional transaccional** ofrece **ACID**: las operaciones críticas pueden agruparse en transacciones con consistencia verificada por **constraints** y aislamiento entre sesiones concurrentes.
- La tabla **`reserva_servicios`** descompone el vínculo M:N entre **reservas** y **servicios** sin repetir datos maestros en cada fila de reserva.

### 9.2 MySQL como SGBD (contexto académico) vs este proyecto

En muchos currículos se destaca **MySQL** por: amplia adopción, buen rendimiento en lecturas, ecosistema LAMP, replicación y tipos de motor (InnoDB transaccional). **Este backend usa PostgreSQL en Supabase**, que comparte las ventajes del modelo relacional y ACID con InnoDB, y además ofrece en este esquema extensiones como **`btree_gist`** y restricciones **EXCLUDE** para reglas de no solapamiento difíciles de expresar solo en aplicación.

### 9.3 Normalización

- **1NF:** Tablas atómicas por columna (sin listas repetidas en un campo); servicios y líneas de reserva en tablas separadas.
- **2NF:** Atributos no clave dependen de la clave completa; en `reserva_servicios`, precios/duración por línea dependen de `reserva_id` + contexto de servicio, no solo de parte de una clave compuesta artificial.
- **3NF:** No hay dependencias transitivas típicas (p. ej. datos del negocio solo en `negocios`, no duplicados en cada `servicio` salvo FK).

### 9.4 Relaciones

- **1:N:** Un `negocio` tiene muchos `servicios`, `horarios`, `bloqueos`, `reservas`; una `reserva` tiene muchos `pagos` y muchas filas en `reserva_servicios`.
- **M:N:** `reservas` ↔ `servicios` mediante **`reserva_servicios`** (clave surrogate + FKs).

### 9.5 Integridad y constraints (implementación real)

Ejemplos del script `sql/2026-03-25-supabase-integrity-constraints.sql`:

| Mecanismo | Ejemplo |
|-----------|---------|
| **CHECK** | `fin_en > inicio_en`, estados permitidos, anticipos coherentes con `anticipo_tipo`, precios no negativos |
| **EXCLUDE** | No solape de horarios activos por negocio/día; no solape de reservas no canceladas por negocio |
| **FOREIGN KEY** | Definidas en el esquema Supabase (integridad referencial); políticas **ON DELETE** concretas dependen de la migración (cascade vs restrict) |
| **NOT NULL** | Campos obligatorios en creación de entidades (según migraciones) |
| **Trigger** | `trg_reservas_no_solapar_bloqueos` evita reservas que crucen `bloqueos` del mismo negocio |

---

## 10. Referencia rápida de API REST

Prefijo base: `/api` (montado en Express).

- `GET /api/health/supabase` — comprobación de conectividad a datos  
- `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me` (protegido), etc.  
- Recursos de negocio: `negocios`, `servicios`, `horarios`, `reservas`, `bloqueos`, `pagos`, `usuarios`, `stripe`  

Rutas públicas vs protegidas se definen en cada archivo de `src/routes/`.

---

## 11. Ejecución local

```bash
npm install
cp .env.example .env   # completar SUPABASE_* y demás
npm run dev
```

El servidor escucha en `PORT` (por defecto `4000`).

---

*Documentación alineada al código del repositorio BackBookNPay. Para el diccionario visual completo, consultar el ERD del sistema de reservas en documentación de equipo o diagramas adjuntos.*
