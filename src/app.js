const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Rutas

app.use('/api/negocios', require('./routes/negocios.routes'));
app.use('/api/servicios', require('./routes/servicios.routes'));
app.use('/api/horarios', requiere('/routes/horarios.routes'));
/*app.use('/api/reservas', require('./routes/reservas.routes'));
app.use('/api/pagos', require('./routes/pagos.routes')); */
app.use('/api/health', require('./routes/health.routes'));
app.use('/api/auth', require('./routes/auth.routes'));

module.exports = app;