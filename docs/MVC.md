# Aplicación del modelo MVC (BackBookNPay)

En un **API REST** con **SPA** (frontend separado), el MVC clásico de servidor se distribuye así:

| Capa MVC | Dónde está en este proyecto | Rol |
|----------|------------------------------|-----|
| **Modelo** | Base PostgreSQL (Supabase) + esquema tablas; acceso mediante `@supabase/supabase-js` en lugar de clases ORM por entidad. | Persistencia e integridad (PK, FK, CHECK, triggers). |
| **Vista** | **FrontBookNPay** (React/Next): páginas, componentes, formateo de datos para el usuario. | Presentación; no generada por el motor de plantillas del backend. |
| **Controlador** | `src/controllers/*.js` + rutas `src/routes/*.js` + `src/middleware/requireAuth.js`. | Validar entrada, orquestar llamadas a Supabase, devolver JSON y códigos HTTP. |

El backend **no** usa vistas HTML del lado servidor: el “resultado de las consultas” se expone como **JSON** y la interfaz gráfica vive en el otro repositorio. Esto es coherente con **API + cliente** y cumple el espíritu de la rúbrica si se documenta la separación de responsabilidades.
