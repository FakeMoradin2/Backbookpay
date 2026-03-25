const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());

// Stripe webhook: must receive raw body (Stripe verifies signature)
// IMPORTANT: this route must come BEFORE app.use(express.json())
const { handleWebhook } = require('./controllers/stripe.controllers');
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    req.body = req.body;
    handleWebhook(req, res);
  }
);

app.use(express.json());

// Stripe routes (checkout, complete-setup)
app.use('/api/stripe', require('./routes/stripe.routes'));

app.use('/api/negocios', require('./routes/negocios.routes'));
app.use('/api/servicios', require('./routes/servicios.routes'));
app.use('/api/horarios', require('./routes/horarios.routes'));
app.use('/api/reservas', require('./routes/reservas.routes'));
app.use('/api/bloqueos', require('./routes/bloqueos.routes'));
app.use('/api/pagos', require('./routes/pagos.routes'));
app.use('/api/usuarios', require('./routes/usuarios.routes'));
app.use('/api/health', require('./routes/health.routes'));
app.use('/api/auth', require('./routes/auth.routes'));

module.exports = app;