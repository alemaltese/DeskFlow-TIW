'use strict';
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/db');
const { requireUtente } = require('../middleware/auth');

const router = express.Router();

const CATEGORIES = ['tecnico', 'account', 'fatturazione', 'altro'];
const PRIORITIES = ['bassa', 'media', 'alta', 'urgente'];

// ── GET /tickets ───────────────────────────────────────────────────────────
router.get('/tickets', requireUtente, (req, res) => {
  const tickets = db.prepare(`
    SELECT * FROM tickets
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.session.user.id);

  res.render('utente/list', { title: 'I miei ticket', tickets });
});

// ── GET /tickets/new ───────────────────────────────────────────────────────
router.get('/tickets/new', requireUtente, (req, res) => {
  if (req.session.user.role !== 'utente') {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Solo gli utenti possono aprire ticket.' });
  }
  res.render('utente/new', {
    title: 'Apri nuovo ticket',
    categories: CATEGORIES,
    priorities: PRIORITIES,
  });
});

// ── POST /tickets ──────────────────────────────────────────────────────────
router.post('/tickets', requireUtente, (req, res) => {
  if (req.session.user.role !== 'utente') {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Solo gli utenti possono aprire ticket.' });
  }
  const { title, description, category, priority } = req.body;
  const errors = [];

  if (!title || !title.trim()) errors.push('Il titolo è obbligatorio.');
  else if (title.trim().length > 100) errors.push('Il titolo non può superare 100 caratteri.');

  if (!description || !description.trim()) errors.push('La descrizione è obbligatoria.');
  else if (description.trim().length > 2000) errors.push('La descrizione non può superare 2000 caratteri.');

  if (!CATEGORIES.includes(category)) errors.push('Categoria non valida.');
  if (!PRIORITIES.includes(priority)) errors.push('Priorità non valida.');

  if (errors.length) {
    return res.render('utente/new', {
      title: 'Apri nuovo ticket',
      categories: CATEGORIES,
      priorities: PRIORITIES,
      errors,
      old: { title, description, category, priority },
    });
  }

  const result = db.prepare(`
    INSERT INTO tickets (user_id, title, description, category, priority, status)
    VALUES (?, ?, ?, ?, ?, 'aperto')
  `).run(req.session.user.id, title.trim(), description.trim(), category, priority);

  db.prepare(`
    INSERT INTO status_history (ticket_id, changed_by, event_type, old_value, new_value)
    VALUES (?, ?, 'status', '', 'aperto')
  `).run(result.lastInsertRowid, req.session.user.id);

  req.setFlash('success', 'Ticket aperto con successo!');
  res.redirect('/tickets');
});

// ── GET /tickets/:id ───────────────────────────────────────────────────────
router.get('/tickets/:id', requireUtente, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  if (isNaN(ticketId)) return res.status(404).render('error', { title: 'Non trovato', message: 'Ticket non trovato.' });

  const ticket = db.prepare(`
    SELECT t.*, u.name AS user_name, op.name AS operator_name
    FROM tickets t
    JOIN users u ON t.user_id = u.id
    LEFT JOIN users op ON t.assigned_to = op.id
    WHERE t.id = ?
  `).get(ticketId);

  if (!ticket) return res.status(404).render('error', { title: 'Non trovato', message: 'Ticket non trovato.' });
  if (ticket.user_id !== req.session.user.id) {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Non puoi visualizzare questo ticket.' });
  }

  const comments = db.prepare(`
    SELECT c.*, u.name AS author_name, u.role AS author_role
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.ticket_id = ? AND c.is_internal = 0
    ORDER BY c.created_at ASC
  `).all(ticketId).map(c => ({ ...c, isOwn: c.user_id === req.session.user.id }));

  const history = db.prepare(`
    SELECT sh.*, u.name AS changed_by_name
    FROM status_history sh
    JOIN users u ON sh.changed_by = u.id
    WHERE sh.ticket_id = ?
    ORDER BY sh.changed_at ASC
  `).all(ticketId);

  const rating = db.prepare('SELECT * FROM ratings WHERE ticket_id = ?').get(ticketId);

  if (rating) {
    rating.starsArr = Array.from({ length: 5 }, (_, i) => ({ filled: i < rating.score }));
  }

  res.render('utente/detail', {
    title: ticket.title,
    ticket,
    comments,
    history,
    rating,
    canClose:   ticket.status === 'risolto' && !rating,
    canReopen:  ticket.status === 'chiuso',
    canComment: ticket.status !== 'chiuso',
  });
});

// ── POST /tickets/:id/comments ─────────────────────────────────────────────
router.post('/tickets/:id/comments', requireUtente, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);

  if (!ticket || ticket.user_id !== req.session.user.id) {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Operazione non consentita.' });
  }
  if (ticket.status === 'chiuso') {
    req.setFlash('error', 'Non puoi commentare un ticket chiuso.');
    return res.redirect(`/tickets/${ticketId}`);
  }

  const { content } = req.body;
  if (!content || !content.trim() || content.trim().length > 1000) {
    req.setFlash('error', 'Il commento non può essere vuoto o superare 1000 caratteri.');
    return res.redirect(`/tickets/${ticketId}`);
  }

  db.prepare(`
    INSERT INTO comments (ticket_id, user_id, content, is_internal)
    VALUES (?, ?, ?, 0)
  `).run(ticketId, req.session.user.id, content.trim());

  req.setFlash('success', 'Commento aggiunto.');
  res.redirect(`/tickets/${ticketId}`);
});

// ── POST /tickets/:id/chiudi ───────────────────────────────────────────────
router.post('/tickets/:id/chiudi', requireUtente, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);

  if (!ticket || ticket.user_id !== req.session.user.id) {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Operazione non consentita.' });
  }
  if (ticket.status !== 'risolto') {
    req.setFlash('error', 'Puoi chiudere solo ticket in stato risolto.');
    return res.redirect(`/tickets/${ticketId}`);
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(`UPDATE tickets SET status = 'chiuso', updated_at = ? WHERE id = ?`).run(now, ticketId);
  db.prepare(`
    INSERT INTO status_history (ticket_id, changed_by, event_type, old_value, new_value, changed_at)
    VALUES (?, ?, 'status', 'risolto', 'chiuso', ?)
  `).run(ticketId, req.session.user.id, now);

  const score = parseInt(req.body.score, 10);
  if (score >= 1 && score <= 5) {
    const note = req.body.note ? req.body.note.trim() || null : null;
    db.prepare(`
      INSERT INTO ratings (ticket_id, user_id, score, note) VALUES (?, ?, ?, ?)
    `).run(ticketId, req.session.user.id, score, note);
  }

  req.setFlash('success', 'Ticket chiuso. Grazie per la valutazione!');
  res.redirect(`/tickets/${ticketId}`);
});

// ── POST /tickets/:id/riapri ───────────────────────────────────────────────
router.post('/tickets/:id/riapri', requireUtente, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);

  if (!ticket || ticket.user_id !== req.session.user.id) {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Operazione non consentita.' });
  }
  if (ticket.status !== 'chiuso') {
    req.setFlash('error', 'Puoi riaprire solo ticket chiusi.');
    return res.redirect(`/tickets/${ticketId}`);
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(`UPDATE tickets SET status = 'aperto', updated_at = ? WHERE id = ?`).run(now, ticketId);
  db.prepare(`
    INSERT INTO status_history (ticket_id, changed_by, event_type, old_value, new_value, changed_at)
    VALUES (?, ?, 'status', 'chiuso', 'aperto', ?)
  `).run(ticketId, req.session.user.id, now);

  req.setFlash('success', 'Ticket riaperto con successo.');
  res.redirect(`/tickets/${ticketId}`);
});

// ── GET /profilo ───────────────────────────────────────────────────────────
router.get('/profilo', requireUtente, (req, res) => {
  if (req.session.user.role !== 'utente') {
    return res.redirect(`/${req.session.user.role}/profilo`);
  }
  res.render('utente/profilo', { title: 'Il mio profilo', user: req.session.user });
});

// ── POST /profilo ──────────────────────────────────────────────────────────
router.post('/profilo', requireUtente, async (req, res) => {
  if (req.session.user.role !== 'utente') {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Operazione non consentita.' });
  }
  const { name, email, old_password, new_password, confirm_password } = req.body;

  if (!name || !name.trim()) {
    req.setFlash('error', 'Il nome non può essere vuoto.');
    return res.redirect('/profilo');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    req.setFlash('error', 'Indirizzo email non valido.');
    return res.redirect('/profilo');
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim(), req.session.user.id);
  if (existing) {
    req.setFlash('error', 'Email già in uso da un altro account.');
    return res.redirect('/profilo');
  }

  if (new_password) {
    if (!old_password) {
      req.setFlash('error', 'Inserisci la password attuale per cambiarla.');
      return res.redirect('/profilo');
    }
    if (new_password !== confirm_password) {
      req.setFlash('error', 'Le nuove password non coincidono.');
      return res.redirect('/profilo');
    }
    if (new_password.length < 6) {
      req.setFlash('error', 'La nuova password deve essere di almeno 6 caratteri.');
      return res.redirect('/profilo');
    }

    const dbUser = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.user.id);
    const match = await bcrypt.compare(old_password, dbUser.password_hash);
    if (!match) {
      req.setFlash('error', 'Password attuale non corretta.');
      return res.redirect('/profilo');
    }

    const newHash = await bcrypt.hash(new_password, 10);
    db.prepare('UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?')
      .run(name.trim(), email.trim(), newHash, req.session.user.id);
  } else {
    db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?')
      .run(name.trim(), email.trim(), req.session.user.id);
  }

  req.session.user = { ...req.session.user, name: name.trim(), email: email.trim() };
  req.setFlash('success', 'Profilo aggiornato con successo.');
  res.redirect('/profilo');
});

module.exports = router;
