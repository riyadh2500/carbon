'use strict';
require('dotenv').config();

const express      = require('express');
const path         = require('path');
const http         = require('http');
const cookieParser = require('cookie-parser');
const { engine }   = require('express-handlebars');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── HTTP server (large header allowance to avoid 431 errors) ─────
const server = http.createServer({ maxHeaderSize: 32768 }, app);

// ── Handlebars setup ─────────────────────────────────────────────
app.engine('hbs', engine({
  extname: '.hbs',
  defaultLayout: false,
  helpers: {
    eq:   (a, b)  => a === b,
    json: (obj)   => JSON.stringify(obj),
    ne:   (a, b)  => a !== b,
    and:  (a, b)  => a && b,
    or:   (a, b)  => a || b,
  },
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// ── Middleware ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.SESSION_SECRET || 'carbon-dev-secret'));

// ── Routes ────────────────────────────────────────────────────────
app.use('/', require('./routes/auth'));        // /login  /register  /logout  /auth/*
app.use('/', require('./routes/landing'));     // /
app.use('/dashboard', require('./routes/dashboard'));
app.use('/api', require('./routes/api'));

// ── 404 ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send('<h1 style="color:#aaff00;font-family:sans-serif;background:#0a0a0a;padding:40px">404 — Page not found</h1>');
});

// ── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('<h1 style="color:#ff4444;font-family:sans-serif;background:#0a0a0a;padding:40px">500 — Server error</h1>');
});

server.listen(PORT, () => {
  console.log(`\n  ✦ Carbon is running at http://localhost:${PORT}`);
  console.log(`  ✦ Supabase: ${process.env.SUPABASE_URL ? 'configured' : 'NOT configured (demo mode)'}\n`);
});
