const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase"); // ajusta el path a tu config

router.get("/supabase", async (req, res) => {
  try {
    // consulta simple a una tabla real
    const { data, error } = await supabase
      .from("negocios")
      .select("id, nombre")
      .limit(1);

    if (error) {
      return res.status(500).json({
        ok: false,
        step: "query negocios",
        error: error.message,
        details: error,
      });
    }

    return res.json({
      ok: true,
      message: "Supabase connection OK",
      sample: data,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      step: "exception",
      error: e.message,
    });
  }
});

module.exports = router;