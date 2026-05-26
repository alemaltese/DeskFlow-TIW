'use strict';
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/db');

const router = express.Router();

// â”€â”€ GET /login â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/login', { title: 'Accedi' });
});

// â”€â”€ POST /login â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('auth/login', { title: 'Accedi', error: 'Compila tutti i campi.', old: { email } });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user) {
    return res.render('auth/login', { title: 'Accedi', error: 'Credenziali non valide.', old: { email } });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.render('auth/login', { title: 'Accedi', error: 'Credenziali non valide.', old: { email } });
  }

  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };

  const returnTo = req.session.returnTo || null;
  delete req.session.returnTo;

  if (user.role === 'admin') {
    return res.redirect(returnTo || '/admin/dashboard');
  }
  if (user.role === 'operatore') {
    return res.redirect(returnTo || '/operatore/dashboard');
  }
  res.redirect(returnTo || '/tickets');
});

// â”€â”€ GET /register â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/register', { title: 'Registrati' });
});

// â”€â”€ POST /register â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/register', async (req, res) => {
  const { name, email, password, confirm_password } = req.body;
  const errors = [];

  if (!name || !name.trim())  errors.push('Il nome Ã¨ obbligatorio.');
  if (!email || !email.trim()) errors.push("L'email Ã¨ obbligatoria.");
  if (!password || password.length < 6) errors.push('La password deve essere di almeno 6 caratteri.');
  if (password !== confirm_password) errors.push('Le password non coincidono.');

  if (errors.length) {
    return res.render('auth/register', { title: 'Registrati', errors, old: { name, email } });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (existing) {
    return res.render('auth/register', {
      title: 'Registrati',
      errors: ['Email già registrata.'],
      old: { name, email },
    });
  }

  const hash = await bcrypt.hash(password, 10);
  const result = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), email.trim().toLowerCase(), hash, 'utente');

  req.session.user = {
    id: result.lastInsertRowid,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    role: 'utente',
  };

  req.setFlash('success', `Benvenuto, ${name.trim()}!`);
  res.redirect('/tickets');
});

// â”€â”€ GET /logout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
