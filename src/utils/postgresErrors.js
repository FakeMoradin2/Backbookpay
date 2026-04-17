/**
 * Mapea códigos de error PostgreSQL (expuestos vía PostgREST/Supabase) a HTTP y mensajes legibles.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  CHECK_VIOLATION: "23514",
  NOT_NULL_VIOLATION: "23502",
  EXCLUSION_VIOLATION: "23P01",
};

function mapPostgresError(err) {
  const code = err && typeof err === "object" ? err.code : null;
  const message = err && typeof err === "object" ? err.message : String(err || "Unknown error");

  switch (code) {
    case PG.UNIQUE_VIOLATION:
      return {
        status: 409,
        body: {
          ok: false,
          error: "Duplicate key: el registro viola una restricción UNIQUE.",
          code,
        },
      };
    case PG.FOREIGN_KEY_VIOLATION:
      return {
        status: 400,
        body: {
          ok: false,
          error: "Foreign key violation: referencia a otra tabla inválida o fila padre inexistente.",
          code,
        },
      };
    case PG.CHECK_VIOLATION:
    case PG.EXCLUSION_VIOLATION:
      return {
        status: 400,
        body: {
          ok: false,
          error: message || "Restricción CHECK o EXCLUDE no satisfecha.",
          code,
        },
      };
    case PG.NOT_NULL_VIOLATION:
      return {
        status: 400,
        body: {
          ok: false,
          error: "Columna obligatoria sin valor (NOT NULL).",
          code,
        },
      };
    default:
      return {
        status: 500,
        body: {
          ok: false,
          error: message,
          ...(code ? { code } : {}),
        },
      };
  }
}

module.exports = {
  mapPostgresError,
  PG,
};
