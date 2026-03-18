const { haySolapamiento } = require("../src/controllers/horarios.controllers");

describe("haySolapamiento helper", () => {
  test("devuelve true cuando los bloques se traslapan", () => {
    const resultado = haySolapamiento("09:00", "12:00", "11:00", "13:00");
    expect(resultado).toBe(true);
  });

  test("devuelve false cuando los bloques están pegados pero no se traslapan", () => {
    const resultado = haySolapamiento("09:00", "12:00", "12:00", "15:00");
    expect(resultado).toBe(false);
  });

  test("devuelve false cuando los bloques no se tocan", () => {
    const resultado = haySolapamiento("09:00", "10:00", "11:00", "12:00");
    expect(resultado).toBe(false);
  });
});

