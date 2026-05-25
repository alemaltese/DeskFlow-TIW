'use strict';
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/db');

const router = express.Router();

// ── GET /login ─────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Accedi' });
});

// ── POST /login ────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { title: 'Accedi', error: 'Compila tutti i campi.', old: { email } });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user) {
    return res.render('login', { title: 'Accedi', error: 'Credenziali non valide.', old: { email } });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.render('login', { title: 'Accedi', error: 'Credenziali non valide.', old: { email } });
  }

  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };

  const returnTo = req.session.returnTo || null;
  delete req.session.returnTo;

  if (user.role === 'admin' || user.role === 'operatore') {
    return res.redirect(returnTo || '/operatore/dashboard');
  }
  res.redirect(returnTo || '/tickets');
});

// ── GET /register ──────────────────────────────────────────────────────────
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { title: 'Registrati' });
});

// ── POST /register ─────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { name, email, password, confirm_password } = req.body;
  const errors = [];

  if (!name || !name.trim())  errors.push('Il nome è obbligatorio.');
  if (!email || !email.trim()) errors.push("L'email è obbligatoria.");
  if (!password || password.length < 6) errors.push('La password deve essere di almeno 6 caratteri.');
  if (password !== confirm_password) errors.push('Le password non coincidono.');

  if (errors.length) {
    return res.render('register', { title: 'Registrati', errors, old: { name, email } });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (existing) {
    return res.render('register', {
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

// ── GET /logout ────────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
