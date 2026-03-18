jest.mock("../src/config/supabase", () => ({
  from: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  single: jest.fn(),
}));

const supabase = require("../src/config/supabase");
const { updateNegocioAdmin } = require("../src/controllers/negocios.controllers");

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

describe("updateNegocioAdmin controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns 403 when user is not admin", async () => {
    const { req, res } = createMockReqRes({
      user: { rol: "cliente", negocio_id: 1 },
      body: { nombre: "Nuevo nombre" },
    });

    await updateNegocioAdmin(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("You do not have permission to update the business");
  });

  test("returns 400 when no update fields are provided", async () => {
    const { req, res } = createMockReqRes({
      body: {},
    });

    await updateNegocioAdmin(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("No fields were provided for update");
  });

  test("updates business when valid fields are provided", async () => {
    supabase.single.mockResolvedValueOnce({
      data: {
        id: 1,
        nombre: "Mi Negocio Actualizado",
        telefono: "555-1234",
      },
      error: null,
    });

    const { req, res } = createMockReqRes({
      body: {
        nombre: "Mi Negocio Actualizado",
        telefono: "555-1234",
      },
    });

    await updateNegocioAdmin(req, res);

    expect(supabase.from).toHaveBeenCalledWith("negocios");
    expect(supabase.update).toHaveBeenCalledWith({
      nombre: "Mi Negocio Actualizado",
      telefono: "555-1234",
    });
    expect(supabase.eq).toHaveBeenCalledWith("id", 1);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual({
      id: 1,
      nombre: "Mi Negocio Actualizado",
      telefono: "555-1234",
    });
  });
});

