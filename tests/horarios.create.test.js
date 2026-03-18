jest.mock("../src/config/supabase", () => ({
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
}));

const supabase = require("../src/config/supabase");
const { createHorarioAdmin } = require("../src/controllers/horarios.controllers");

const createMockReqRes = (overridesReq = {}) => {
  const req = {
    user: { rol: "admin", negocio_id: 1 },
    body: {},
    ...overridesReq,
  };

  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  return { req, res };
};

describe("createHorarioAdmin controller - basic validations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns 400 when required fields are missing", async () => {
    const { req, res } = createMockReqRes({
      body: { dia_semana: "lun", hora_inicio: "09:00" }, // falta hora_fin
    });

    await createHorarioAdmin(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/required/);
  });

  test("returns 400 when dia_semana is invalid", async () => {
    const { req, res } = createMockReqRes({
      body: { dia_semana: "xxx", hora_inicio: "09:00", hora_fin: "10:00" },
    });

    await createHorarioAdmin(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("Invalid dia_semana value");
  });

  test("returns 400 when hora_inicio is greater or equal than hora_fin", async () => {
    const { req, res } = createMockReqRes({
      body: { dia_semana: "lun", hora_inicio: "10:00", hora_fin: "09:00" },
    });

    await createHorarioAdmin(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("hora_inicio must be earlier than hora_fin");
  });
});

