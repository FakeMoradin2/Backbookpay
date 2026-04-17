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

## 10. API REST — Referencia completa de endpoints

**URL base (desarrollo):** `http://localhost:4000` (o el valor de `PORT`).  
**Prefijo:** todas las rutas siguientes cuelgan de `/api/...` salvo el webhook de Stripe, registrado en `src/app.js` como `/api/stripe/webhook`.

**Formato:** salvo el webhook, el cuerpo suele ser **JSON** (`Content-Type: application/json`).

**Convención de respuestas:** la mayoría devuelve un objeto con `ok: boolean`. En errores suele incluirse `error` (string) y a veces `step` (contexto interno). Los mensajes de error están en **inglés** (texto del código).

**Autenticación:** rutas marcadas como **Bearer** esperan cabecera:

```http
Authorization: Bearer <access_token_de_Supabase>
```

El middleware `requireAuth` (`src/middleware/requireAuth.js`) valida el JWT, carga el perfil en `usuarios` y rechaza usuarios con `activo: false`.

| Código HTTP | Significado habitual |
|-------------|----------------------|
| 200 | Éxito (GET/PATCH con cuerpo) |
| 201 | Recurso creado |
| 400 | Validación / parámetros incorrectos |
| 401 | Sin token, token inválido o perfil no encontrado |
| 403 | Token válido pero sin permiso o rol incorrecto |
| 404 | Recurso no encontrado |
| 409 | Conflicto (email duplicado, solapes, etc.) |
| 500 | Error de servidor o de Supabase/Stripe |
| 503 | Proveedor de auth no disponible (red) |

---

### 10.1 Salud y webhook Stripe

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/health/supabase` | No | Ping a Supabase: `select` mínimo en `negocios` (1 fila). |

**`GET /api/health/supabase`**

- **Respuesta 200:** `{ ok: true, message: "Supabase connection OK", sample: [...] }`
- **500:** `{ ok: false, step, error, details? }`

**`POST /api/stripe/webhook`** (definido en `app.js`, **antes** de `express.json`)

- **Cuerpo:** bytes crudos del evento Stripe (`express.raw`), no JSON parseado por Express.
- **Cabecera:** `Stripe-Signature` (obligatoria para verificar el evento).
- **Comportamiento:** verifica firma con `STRIPE_WEBHOOK_SECRET`; procesa eventos como `checkout.session.completed`, `checkout.session.expired`, `account.updated`, etc.
- **Respuesta 200:** `{ ok: true, received: true }` en flujos correctos.
- **400:** firma inválida o metadata incompleta en algún flujo.
- **500:** Stripe no configurado, webhook secret ausente, o error al procesar el evento.

---

### 10.2 Autenticación (`/api/auth`)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/auth/login` | No | Email + contraseña → tokens Supabase. |
| GET | `/api/auth/me` | Bearer | Perfil ya adjuntado por middleware (`req.user`). |
| POST | `/api/auth/register` | No | Alta de usuario (roles `admin`, `staff`, `cliente` con reglas propias). |
| POST | `/api/auth/refresh` | No | Nuevo access token con `refresh_token`. |
| POST | `/api/auth/logout` | No | Respuesta informativa; el cliente debe borrar tokens. |

**`POST /api/auth/login`** — Body: `{ "email", "password" }`

- **200:** `{ ok: true, access_token, refresh_token, expires_in, token_type, user_id }`
- **400:** credenciales faltantes o error de Supabase Auth.

**`GET /api/auth/me`** — Bearer

- **200:** `{ ok: true, user: { id, correo, nombre, rol, negocio_id, activo } }` (campos del perfil cargado en middleware).

**`POST /api/auth/register`** — Body (ejemplo): `{ email, password, nombre, rol?, invite_code?, negocio_id? }`

- **Admin:** requiere `invite_code === ADMIN_INVITE_CODE`; crea negocio y perfil.
- **Staff:** requiere `negocio_id`.
- **201:** según caso: tokens si hay sesión, o `{ ok: true, message, user_id, negocio_id? }` si confirma email u otro flujo sin sesión inmediata.
- **400 / 403 / 409 / 500:** validaciones, código de invitación, duplicados, errores DB.

**`POST /api/auth/refresh`** — Body: `{ "refresh_token" }`

- **200:** `{ ok: true, access_token, refresh_token, expires_in, token_type }`
- **400:** falta `refresh_token`.
- **401:** refresh inválido.

**`POST /api/auth/logout`**

- **200:** `{ ok: true, message: "Logout successful. The client must remove stored tokens." }`

---

### 10.3 Stripe (checkout admin, Connect, depósitos) (`/api/stripe`)

Rutas en `src/routes/stripe.routes.js` (montaje `/api/stripe`). Todas las de esta tabla son **JSON** excepto el webhook ya descrito.

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/stripe/create-checkout-session` | No | Crea sesión Checkout para comprar cuenta admin (pago único). |
| POST | `/api/stripe/complete-admin-setup` | No | Tras pagar, completa registro admin con `session_id` + `password`. |
| POST | `/api/stripe/connect/account-link` | Bearer (admin) | Onboarding Stripe Connect Express para el negocio. |
| POST | `/api/stripe/connect/sync-status` | Bearer (admin) | Sincroniza estado de la cuenta Connect desde Stripe. |
| POST | `/api/stripe/deposit-verify-session` | Bearer (cliente) | Verifica pago de depósito tras Checkout. |
| POST | `/api/stripe/deposit-cancel-pending` | Bearer (cliente) | Cancela limpieza de reserva `pendiente_pago` sin pago. |
| POST | `/api/stripe/deposit-checkout` | Bearer (cliente) | Crea Checkout Session para pagar anticipo de una reserva. |

**`POST .../create-checkout-session`** — `{ nombre, email }`

- **200:** `{ ok: true, url, session_id }` (URL de Stripe Checkout).
- **400 / 409 / 500:** validación, email ya admin, error Stripe.

**`POST .../complete-admin-setup`** — `{ session_id, password }`

- **200:** `{ ok: true, access_token, refresh_token, expires_in, token_type, user_id }`
- **400:** pago incompleto, sesión inválida, email faltante, etc.
- **500:** Stripe no configurado u error al crear usuario.

**`POST .../connect/account-link`**

- **200:** `{ ok: true, url }` (enlace de onboarding o actualización).
- **403 / 404 / 500:** solo admin, negocio no encontrado, error Stripe.

**`POST .../connect/sync-status`**

- **200:** `{ ok: true, account_id, charges_enabled, details_submitted, payouts_enabled }`
- **400:** aún no hay cuenta Connect.
- **403 / 404 / 500:** permisos o errores.

**`POST .../deposit-verify-session`** — `{ session_id }`

- **200:** `{ ok: true, verified: true, reserva_id, status: "confirmada" }` (tras aplicar lógica de depósito pagado).
- **400 / 403 / 404 / 409:** rol, sesión incorrecta, reserva ajena, pago aún no completado (`409` con `status`, `payment_status`).

**`POST .../deposit-cancel-pending`** — `{ reserva_id }`

- **200:** `{ ok: true, cleaned?: boolean, skipped?: boolean }` según `cleanupPendingDepositReservation`.
- **403 / 404 / 500:** permisos o reserva no encontrada.

**`POST .../deposit-checkout`** — `{ reserva_id }`

- **200:** `{ ok: true, url, session_id }`
- **400:** estado no `pendiente_pago`, sin anticipo, negocio sin Connect, monto demasiado bajo, etc.
- **403 / 404:** no es el cliente dueño o reserva inexistente.

---

### 10.4 Negocios (`/api/negocios`)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/negocios/negocios` | No | Lista negocios activos. |
| GET | `/api/negocios/negocios/:id` | No | Detalle público de un negocio activo. |
| GET | `/api/negocios/admin/negocio` | Bearer | Negocio del usuario autenticado. |
| PATCH | `/api/negocios/admin/negocio` | Bearer (solo **admin**) | Actualiza datos del negocio del usuario. |

**`GET .../negocios`**

- **200:** `{ ok: true, data: [...], count }`

**`GET .../negocios/:id`**

- **200:** `{ ok: true, data: { ...negocio } }`
- **404:** negocio inexistente o inactivo.

**`GET .../admin/negocio`**

- **200:** `{ ok: true, data }`
- **404 / 500:** no encontrado o error consulta.

**`PATCH .../admin/negocio`** — campos opcionales: `nombre`, `telefono`, `correo`, `zona_horaria`, `duracion_buffer_min`, `imagen_url`

- **403:** usuario no es `admin`.
- **400:** ningún campo enviado.
- **200:** `{ ok: true, data }`

---

### 10.5 Servicios (`/api/servicios`)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/servicios/` | No | Lista servicios (filtros por query). |
| GET | `/api/servicios/admin/servicios` | Bearer | Servicios activos del negocio del usuario. |
| POST | `/api/servicios/admin/servicios` | Bearer (**admin**) | Crea servicio. |
| PATCH | `/api/servicios/admin/servicios/:id` | Bearer (**admin**) | Actualiza servicio. |
| DELETE | `/api/servicios/admin/servicios/:id` | Bearer (**admin**) | Baja lógica (`activo: false`). |

**`GET /api/servicios/`** — Query opcional:

- `negocio_id`: filtrar por negocio.
- `q`: búsqueda por nombre/descripción (ilike).
- `include_business=true`: incluye datos del negocio en el `select`.

**200:** `{ ok: true, data: [...], count }`

**`GET .../admin/servicios`**

- **200:** `{ ok: true, data, count }`

**`POST .../admin/servicios`** — Requiere `nombre`, `duracion_min`, `precio`, `anticipo_tipo` (`fijo` | `porcentaje` | `no_requiere`); reglas de `anticipo_valor` y, si aplica depósito, negocio con Stripe Connect listo.

- **201:** `{ ok: true, data }`
- **400 / 403 / 500:** validación, permisos, Stripe no listo para anticipos.

**`PATCH .../admin/servicios/:id`** — campos parciales; mismas reglas de anticipo/Stripe si se exige depósito.

- **200:** `{ ok: true, data }`
- **404:** servicio no pertenece al negocio.

**`DELETE .../admin/servicios/:id`**

- **200:** `{ ok: true, data }` (registro con `activo: false`).

---

### 10.6 Horarios (`/api/horarios`)

Días válidos: `lun`, `mar`, `mie`, `jue`, `vie`, `sab`, `dom`. Crear/editar horarios: solo **admin**.

| Método | Ruta | Auth |
|--------|------|------|
| GET | `/api/horarios/admin/horarios` | Bearer |
| POST | `/api/horarios/admin/horarios` | Bearer (admin) |
| POST | `/api/horarios/admin/horarios/bulk` | Bearer (admin) |
| PATCH | `/api/horarios/admin/horarios/:id` | Bearer (admin) |
| DELETE | `/api/horarios/admin/horarios/:id` | Bearer (admin) |

**`GET .../admin/horarios`**

- **200:** `{ ok: true, data: [...], count }` (solo `activo: true`).

**`POST .../admin/horarios`** — `{ dia_semana, hora_inicio, hora_fin, activo? }`

- **201:** `{ ok: true, data }`
- **400:** solape con otro bloque del mismo día, u otras validaciones.

**`POST .../admin/horarios/bulk`** — `{ dias_semana: ["lun", ...], hora_inicio, hora_fin, activo? }`

- **201:** `{ ok: true, created: [...], failed?, message }` (puede crear parcialmente y listar `failed` por día).

**`PATCH .../admin/horarios/:id`**

- **200:** `{ ok: true, data }`
- **404:** bloque no encontrado.

**`DELETE .../admin/horarios/:id`**

- **200:** `{ ok: true, data }` (fila eliminada).

---

### 10.7 Bloqueos (`/api/bloqueos`)

Solo **admin** del negocio.

| Método | Ruta | Auth |
|--------|------|------|
| GET | `/api/bloqueos/admin/bloqueos` | Bearer |
| POST | `/api/bloqueos/admin/bloqueos` | Bearer |
| DELETE | `/api/bloqueos/admin/bloqueos/:id` | Bearer |

**`POST .../admin/bloqueos`** — `{ inicio_en, fin_en, motivo? }` (ISO datetimes)

- **201:** `{ ok: true, data }`
- **409:** existen reservas `pendiente_pago` o `confirmadas` en el intervalo (`conflicts`, `conflicts_count`).

**`DELETE .../admin/bloqueos/:id`**

- **200:** `{ ok: true, data }` (datos del bloqueo eliminado).

---

### 10.8 Pagos (`/api/pagos`)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/pagos/admin/pagos` | Bearer (**admin** o **staff**) | Lista pagos de reservas del negocio. |

**Query opcional:** `status` (estado de pago), `from`, `to` (fechas sobre `creado_en`), `reserva_id`.

- **200:** `{ ok: true, data: [...], count }` cada ítem incluye relación `reservas(...)` cuando aplica.
- **403:** rol no permitido.
- **400:** usuario sin `negocio_id`.

Estados válidos filtro: `creado`, `pendiente`, `pagado`, `fallido`, `cancelado`, `reembolsado`.

---

### 10.9 Usuarios / perfiles (`/api/usuarios`)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/usuarios/me` | Bearer | Perfil desde tabla `usuarios` (`telefono`, `creado_en`, etc.); más campos que `GET /api/auth/me`. |
| PATCH | `/api/usuarios/me` | Bearer | Actualiza `nombre`, `correo`, `telefono` del perfil. |
| GET | `/api/usuarios/admin/staff` | Bearer (admin/staff) | Lista staff del negocio. |
| POST | `/api/usuarios/admin/staff` | Bearer (**admin**) | Crea usuario staff (requiere `SUPABASE_SERVICE_ROLE_KEY`). |
| PATCH | `/api/usuarios/admin/staff/:id/active` | Bearer (**admin**) | Activa/desactiva staff (`activo` boolean). |
| GET | `/api/usuarios/public/staff` | No | Staff público por negocio. |

**`GET .../public/staff`** — Query: `negocio_id` (obligatorio)

- **200:** `{ ok: true, data: [{ id, nombre }], count }`

**`POST .../admin/staff`** — `{ nombre, correo, telefono?, password }` (password mín. 6 caracteres)

- **201:** `{ ok: true, data: perfil staff }`
- **409:** email ya registrado.
- **500:** falta service role key en servidor.

**`PATCH .../admin/staff/:id/active`** — `{ activo: boolean }`

- **200:** `{ ok: true, data }`
- **409:** al desactivar, si hay reservas futuras activas asignadas (`conflicts`, `conflicts_count`).

---

### 10.10 Reservas (`/api/reservas`)

Estados válidos globales (referencia): `pendiente_pago`, `confirmada`, `cancelada`, `completada`, `no_show`, `expirada`.

#### Públicos (sin Bearer)

| Método | Ruta | Query / notas |
|--------|------|----------------|
| GET | `/api/reservas/public/disponibilidad` | `negocio_id`, `fecha` (YYYY-MM-DD), `servicio_ids` (CSV), opcional `staff_id`, `step_min` (default 15) |
| GET | `/api/reservas/public/fechas-disponibles` | `negocio_id`, `servicio_ids`, opcional `staff_id`, `step_min`, `days` (default 30, máx 365) |

**`.../disponibilidad` — 200:**

```json
{
  "ok": true,
  "data": {
    "slots": [
      {
        "label": "09:00",
        "start_iso": "...",
        "end_iso": "...",
        "block_key": "...",
        "block_start": "...",
        "block_end": "..."
      }
    ],
    "occupied_minutes": 60
  }
}
```

Si no hay horario ese día: `slots: []`.

**`.../fechas-disponibles` — 200:**

```json
{
  "ok": true,
  "data": {
    "dates": [{ "date": "2026-04-20", "weekday": "lun", "slots_count": 12 }],
    "occupied_minutes": 60
  }
}
```

#### Cliente (Bearer, rol `cliente`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/reservas/cliente/mis-reservas` | Lista reservas del usuario (excluye `cancelada`), con `reserva_servicios` y nombre de negocio. |
| POST | `/api/reservas/cliente/reservas` | Crea reserva. |
| POST | `/api/reservas/cliente/reservas/:id/cancel` | Elimina reserva y líneas relacionadas (no estados finales). |
| PATCH | `/api/reservas/cliente/reservas/:id/reagendar` | Cambia `inicio_en`/`fin_en` si estado permite. |

**`POST .../cliente/reservas`** — Body:

```json
{
  "negocio_id": "uuid",
  "staff_id": "uuid opcional",
  "servicios": [{ "servicio_id": "uuid", "cantidad": 1 }],
  "inicio_en": "ISO8601",
  "nota": "opcional"
}
```

- **201:** `{ ok: true, data: { reserva, servicios, computed_end, occupied_minutes, deposit_amount, can_pay_deposit_online } }`
- Estado inicial: `pendiente_pago` si hay anticipo > 0; si no, `confirmada`.
- **403 / 404 / 400:** rol, negocio, horario, solapes, bloqueos, staff.

**`POST .../cliente/reservas/:id/cancel`**

- **200:** `{ ok: true, deleted: true, id }` (borrado físico de reserva, detalles y pagos asociados en flujo cancelación).
- **400:** estado `completada`, `cancelada` o `expirada`.

**`PATCH .../cliente/reservas/:id/reagendar`** — `{ inicio_en }`

- **200:** `{ ok: true, data: reserva actualizada }`
- Solo si estado en `pendiente_pago` o `confirmada`.

#### Admin / Staff (Bearer)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/reservas/admin/reservas` | Cita manual (cliente registrado o invitado). |
| GET | `/api/reservas/admin/reservas` | Lista reservas del negocio; hidrata cliente, staff, `reserva_servicios`, `pagos`. |
| PATCH | `/api/reservas/admin/reservas/:id/estado` | Cambia `estado`. |
| PATCH | `/api/reservas/admin/reservas/:id/reagendar` | Reagenda; body puede incluir `staff_id` (admin); staff forzado a sí mismo si rol `staff`. |
| PATCH | `/api/reservas/admin/reservas/:id/staff` | Reasigna `staff_id` si el hueco sigue libre. |

**`POST .../admin/reservas`** — Body incluye `servicios`, `inicio_en`, opcional `cliente_id` **o** datos manuales `cliente_nombre`, `cliente_correo`, `cliente_telefono`, `staff_id`, `nota`, `estado` (opcional, debe ser estado válido).

- **201:** `{ ok: true, data: { reserva, client, servicios, computed_end, occupied_minutes } }`
- Staff con rol `staff` se asigna a sí mismo; admin puede elegir staff.

**`GET .../admin/reservas`** — Query: `from`, `to` (sobre `inicio_en`), `status` (filtro estado).

- **200:** `{ ok: true, data: [...], count }` cada elemento incluye `usuarios`, `staff`, `reserva_servicios`, `pagos`.

**`PATCH .../admin/reservas/:id/estado`** — `{ estado }`

- **200:** `{ ok: true, data }`

**`PATCH .../admin/reservas/:id/reagendar`** — `{ inicio_en, staff_id? }` (reglas de staff arriba)

**`PATCH .../admin/reservas/:id/staff`** — `{ staff_id }` (obligatorio; staff solo puede asignarse a sí mismo)

---

## 11. Rúbrica académica: scripts SQL, integridad referencial, seguridad y MVC

### 11.1 Paquete `sql/rubric/` (roles, seed, consultas, vistas, mantenimiento)

| Archivo | Contenido |
|---------|-----------|
| `sql/rubric/README.md` | Orden de ejecución y notas Supabase |
| `01_roles_privileges.sql` | Tres roles: **Analista** (solo `SELECT`), **Editor** (DML en tablas operativas; ejemplo de `REVOKE DELETE`), **Admin DB** (privilegios amplios) + usuarios de login de demo |
| `02_seed_stress_test.sql` | Carga masiva: ≥100 filas en `negocios`, `servicios`, `horarios`, `bloqueos`, `reservas`, `reserva_servicios`, `pagos` (prefijo `Stress Seed` / `Cliente Stress` para limpieza) |
| `03_queries_basic.sql` | 40 consultas básicas |
| `04_queries_intermediate.sql` | 20 consultas con JOIN, `GROUP BY`/`HAVING`, subconsultas |
| `05_queries_advanced.sql` | 20 consultas: CTE, funciones de ventana, `WITH RECURSIVE`, transacciones |
| `06_views_indexes_explain.sql` | Vistas de reporte + índice demo + `EXPLAIN (ANALYZE)` |
| `07_maintenance_update_delete.sql` | `UPDATE` masivos y `DELETE` controlados en transacciones |

Índice de cobertura: `docs/RUBRICA-BD.md`.

### 11.2 Tabla referencial: PK, FK y políticas típicas (PostgreSQL)

Las políticas **ON DELETE** exactas dependen de las migraciones aplicadas en Supabase; a continuación el **modelo lógico** alineado al código y a `sql/2026-04-15-staff-reservas.sql`:

| Tabla | PK | FK principales | ON DELETE (referencia) |
|-------|-----|----------------|-------------------------|
| `negocios` | `id` (uuid) | — | — |
| `usuarios` | `id` (uuid) | `negocio_id` → `negocios.id` | suele ser **SET NULL** o **RESTRICT** según migración |
| `servicios` | `id` | `negocio_id` → `negocios.id` | **CASCADE** o **RESTRICT** (evitar borrar negocio con servicios) |
| `horarios` | `id` | `negocio_id` → `negocios.id` | **CASCADE** típico |
| `bloqueos` | `id` | `negocio_id` → `negocios.id` | **CASCADE** típico |
| `reservas` | `id` | `negocio_id` → `negocios.id`; `usuario_id` → `usuarios.id`; `staff_id` → `usuarios.id` | `staff_id`: **SET NULL** (`2026-04-15-staff-reservas.sql`); resto según migración |
| `reserva_servicios` | `id` | `reserva_id` → `reservas.id`; `servicio_id` → `servicios.id` | **CASCADE** al borrar reserva/servicio (habitual) |
| `pagos` | `id` | `reserva_id` → `reservas.id` | **CASCADE** o **RESTRICT** |

**Restricciones adicionales:** `UNIQUE` en columnas de negocio según diseño; `NOT NULL` en campos obligatorios; **CHECK** y **EXCLUDE** en `sql/2026-03-25-supabase-integrity-constraints.sql`.

### 11.3 Seguridad: AES, BCrypt y TLS (cierre de rúbrica)

| Tema | Implementación en el proyecto |
|------|-------------------------------|
| **TLS/SSL** | Tráfico hacia Supabase y Stripe por **HTTPS**; en producción el API debe publicarse también con TLS. |
| **Hashing de contraseñas (equivalente BCrypt)** | No se hashea en Node: **Supabase Auth** almacena credenciales con esquemas fuertes (p. ej. derivación tipo bcrypt/argon según versión del servicio). |
| **AES (encriptación de datos sensibles)** | La aplicación **no** implementa AES propio; datos de pago sensibles se delegan a **Stripe** (PCI). Para campos propios cifrados en reposo, usar pgcrypto / columnas cifradas en Postgres o políticas del proveedor. |

### 11.4 Manejo de errores de base en el backend

- Utilidad: `src/utils/postgresErrors.js` — traduce códigos PostgreSQL (`23505` duplicado, `23503` FK, `23514` CHECK/EXCLUDE, etc.) a HTTP **409**/**400**.
- Uso de ejemplo: inserción/actualización/baja lógica en `src/controllers/servicios.controllers.js`.

### 11.5 Respaldos, alta disponibilidad y migraciones

- Comandos **pg_dump** / **pg_restore** y conceptos de réplica / Multi-AZ: `docs/BACKUPS-HA-MIGRACIONES.md`.
- Convención de migraciones tipo Flyway: `sql/migrations/README.md`.
- **MVC** (API + frontend): `docs/MVC.md`.

---

## 12. Ejecución local

```bash
npm install
cp .env.example .env   # completar SUPABASE_* y demás
npm run dev
```

El servidor escucha en `PORT` (por defecto `4000`).

---

*Documentación alineada al código del repositorio BackBookNPay. Para el diccionario visual completo, consultar el ERD del sistema de reservas en documentación de equipo o diagramas adjuntos. Entregables SQL de rúbrica: `sql/rubric/` y `docs/RUBRICA-BD.md`.*
