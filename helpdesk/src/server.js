'use strict';
const express = require('express');
const { engine } = require('express-handlebars');
const session = require('express-session');
const path = require('path');

require('./db/connection');

const flashMiddleware  = require('./middleware/flash');
const authRouter       = require('./routes/auth');
const ticketsRouter    = require('./routes/tickets');
const operatoreRouter  = require('./routes/operatore');
const adminRouter      = require('./routes/admin');
const statsRouter      = require('./routes/stats');

const app = express();

// ── Handlebars ─────────────────────────────────────────────────────────────
app.engine('hbs', engine({
  extname: '.hbs',
  layoutsDir:   path.join(__dirname, '../views/layouts'),
  partialsDir:  path.join(__dirname, '../views/partials'),
  defaultLayout: 'main',
  helpers: {
    formatDate(dateStr) {
      if (!dateStr) return '';
      const iso = String(dateStr).replace(' ', 'T');
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(dateStr);
      return d.toLocaleString('it-IT', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    },
    eq(a, b) { return String(a) === String(b); },
    capitalize(str) {
      if (!str) return '';
      const s = String(str);
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
    ifEq(a, b, options) {
      return String(a) === String(b) ? options.fn(this) : options.inverse(this);
    },
  },
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, '../views'));

// ── Static + body ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Session ────────────────────────────────────────────────────────────────
app.use(session({
  secret: 'helpdesk-secret',
  resave: false,
  saveUninitialized: false,
}));

// ── Flash ──────────────────────────────────────────────────────────────────
app.use(flashMiddleware);

// ── Current user in locals (navbar) ───────────────────────────────────────
app.use((req, res, next) => {
  const u = req.session.user || null;
  res.locals.currentUser  = u;
  res.locals.isOperatore  = u && (u.role === 'operatore' || u.role === 'admin');
  res.locals.isAdmin      = u && u.role === 'admin';
  res.locals.currentYear  = new Date().getFullYear();
  next();
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const u = req.session.user;
  if (!u) return res.render('home', { title: 'Helpdesk' });
  if (u.role === 'admin')     return res.redirect('/admin/dashboard');
  if (u.role === 'operatore') return res.redirect('/operatore/dashboard');
  return res.redirect('/tickets');
});

app.use('/', authRouter);
app.use('/', ticketsRouter);
app.use('/', operatoreRouter);
app.use('/', adminRouter);
app.use('/', statsRouter);

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', { title: 'Pagina non trovata', message: 'La pagina richiesta non esiste.' });
});

// ── 500 ────────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[500]', err);
  res.status(500).render('error', {
    title: 'Errore interno',
    message: 'Si è verificato un errore interno del server.',
  });
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
