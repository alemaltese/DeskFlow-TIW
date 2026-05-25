'use strict';
const express = require('express');
const { engine } = require('express-handlebars');
const session = require('express-session');
const path = require('path');

require('./db/db');

const authRouter     = require('./routes/auth');
const ticketsRouter  = require('./routes/tickets');
const operatoreRouter = require('./routes/operatore');
const adminRouter    = require('./routes/admin');
const statsRouter    = require('./routes/stats');

const app = express();

// ── Handlebars ─────────────────────────────────────────────────────────────
app.engine('hbs', engine({
  extname: '.hbs',
  layoutsDir: path.join(__dirname, '../views/layouts'),
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
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.setFlash = (type, message) => { req.session.flash = { type, message }; };
  next();
});

// ── Current user in locals (navbar) ───────────────────────────────────────
app.use((req, res, next) => {
  const u = req.session.user || null;
  res.locals.currentUser  = u;
  res.locals.isOperatore  = u && (u.role === 'operatore' || u.role === 'admin');
  res.locals.isAdmin      = u && u.role === 'admin';
  next();
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.render('home', { title: 'Helpdesk' });
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

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
