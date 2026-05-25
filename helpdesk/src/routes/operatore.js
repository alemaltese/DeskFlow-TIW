'use strict';
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/db');
const { requireOperatore } = require('../middleware/auth');

const router = express.Router();

const VALID_STATUS   = ['aperto', 'in_corso', 'risolto', 'chiuso'];
const VALID_PRIORITY = ['bassa', 'media', 'alta', 'urgente'];
const VALID_CATEGORY = ['tecnico', 'account', 'fatturazione', 'altro'];

const PRIORITY_ORDER = `CASE t.priority
  WHEN 'urgente' THEN 4
  WHEN 'alta'    THEN 3
  WHEN 'media'   THEN 2
  ELSE 1 END`;

// ── GET /operatore/dashboard ───────────────────────────────────────────────
router.get('/operatore/dashboard', requireOperatore, (req, res) => {
  const opId = req.session.user.id;

  // Conteggi per stato
  const statusRows = db.prepare(`
    SELECT status, COUNT(*) AS n FROM tickets WHERE assigned_to = ? GROUP BY status
  `).all(opId);
  const counts = { aperto: 0, in_corso: 0, risolto: 0, chiuso: 0 };
  statusRows.forEach(r => { counts[r.status] = r.n; });

  // Ticket attivi ordinati per priorità e poi data
  const activeTickets = db.prepare(`
    SELECT t.*, u.name AS user_name
    FROM tickets t
    JOIN users u ON t.user_id = u.id
    WHERE t.assigned_to = ? AND t.status IN ('aperto', 'in_corso')
    ORDER BY ${PRIORITY_ORDER} DESC, t.created_at ASC
  `).all(opId);

  // Risolti questo mese
  const resolvedThisMonth = db.prepare(`
    SELECT COUNT(*) AS n FROM tickets
    WHERE assigned_to = ?
      AND status IN ('risolto', 'chiuso')
      AND strftime('%Y-%m', updated_at) = strftime('%Y-%m', 'now')
  `).get(opId).n;

  // Rating medio
  const avgRow = db.prepare(`
    SELECT ROUND(AVG(r.score), 1) AS avg
    FROM ratings r
    JOIN tickets t ON r.ticket_id = t.id
    WHERE t.assigned_to = ?
  `).get(opId);
  const avgRating = avgRow.avg || null;
  const avgStars = avgRating
    ? Array.from({ length: 5 }, (_, i) => ({ filled: i < Math.round(avgRating) }))
    : null;

  res.render('operatore/dashboard', {
    title: 'Dashboard',
    counts,
    activeTickets,
    kpi: { resolvedThisMonth, avgRating, avgStars },
  });
});

// ── GET /operatore/tickets ─────────────────────────────────────────────────
router.get('/operatore/tickets', requireOperatore, (req, res) => {
  const { status, priority, category, search } = req.query;

  const conditions = ['t.assigned_to = ?'];
  const params = [req.session.user.id];

  if (status && VALID_STATUS.includes(status)) {
    conditions.push('t.status = ?'); params.push(status);
  }
  if (priority && VALID_PRIORITY.includes(priority)) {
    conditions.push('t.priority = ?'); params.push(priority);
  }
  if (category && VALID_CATEGORY.includes(category)) {
    conditions.push('t.category = ?'); params.push(category);
  }
  if (search && search.trim()) {
    conditions.push('(t.title LIKE ? OR t.description LIKE ?)');
    const term = `%${search.trim()}%`;
    params.push(term, term);
  }

  const tickets = db.prepare(`
    SELECT t.*, u.name AS user_name
    FROM tickets t
    JOIN users u ON t.user_id = u.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${PRIORITY_ORDER} DESC, t.created_at DESC
  `).all(...params);

  res.render('operatore/list', {
    title: 'I miei ticket',
    tickets,
    filters: { status: status || '', priority: priority || '', category: category || '', search: search || '' },
    hasFilters: !!(status || priority || category || search),
  });
});

// ── GET /operatore/tickets/:id ─────────────────────────────────────────────
router.get('/operatore/tickets/:id', requireOperatore, (req, res) => {
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
  if (ticket.assigned_to !== req.session.user.id) {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Questo ticket non ti è assegnato.' });
  }

  const comments = db.prepare(`
    SELECT c.*, u.name AS author_name, u.role AS author_role
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.ticket_id = ?
    ORDER BY c.created_at ASC
  `).all(ticketId).map(c => ({
    ...c,
    isOwn: !c.is_internal && c.user_id === req.session.user.id,
  }));

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

  res.render('operatore/ticket-detail', {
    title: ticket.title,
    ticket,
    comments,
    history,
    rating,
  });
});

// ── POST /operatore/tickets/:id/status ─────────────────────────────────────
router.post('/operatore/tickets/:id/status', requireOperatore, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);

  if (!ticket || ticket.assigned_to !== req.session.user.id) {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Operazione non consentita.' });
  }

  const { new_status } = req.body;
  if (!['in_corso', 'risolto'].includes(new_status)) {
    req.setFlash('error', 'Stato non valido. Puoi impostare solo "in_corso" o "risolto".');
    return res.redirect(`/operatore/tickets/${ticketId}`);
  }

  if (ticket.status === new_status) {
    req.setFlash('info', 'Il ticket è già in quello stato.');
    return res.redirect(`/operatore/tickets/${ticketId}`);
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?`).run(new_status, now, ticketId);
  db.prepare(`
    INSERT INTO status_history (ticket_id, changed_by, event_type, old_value, new_value, changed_at)
    VALUES (?, ?, 'status', ?, ?, ?)
  `).run(ticketId, req.session.user.id, ticket.status, new_status, now);

  req.setFlash('success', `Stato aggiornato a "${new_status}".`);
  res.redirect(`/operatore/tickets/${ticketId}`);
});

// ── POST /operatore/tickets/:id/comments ───────────────────────────────────
router.post('/operatore/tickets/:id/comments', requireOperatore, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);

  if (!ticket || ticket.assigned_to !== req.session.user.id) {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Operazione non consentita.' });
  }

  const { content, is_internal: isInternalStr } = req.body;
  if (!content || !content.trim() || content.trim().length > 1000) {
    req.setFlash('error', 'Il messaggio non può essere vuoto o superare 1000 caratteri.');
    return res.redirect(`/operatore/tickets/${ticketId}`);
  }

  const is_internal = isInternalStr === '1' ? 1 : 0;
  db.prepare(`
    INSERT INTO comments (ticket_id, user_id, content, is_internal)
    VALUES (?, ?, ?, ?)
  `).run(ticketId, req.session.user.id, content.trim(), is_internal);

  req.setFlash('success', is_internal ? 'Nota interna aggiunta.' : 'Risposta inviata al cliente.');
  res.redirect(`/operatore/tickets/${ticketId}`);
});

// ── GET /operatore/profilo ─────────────────────────────────────────────────
router.get('/operatore/profilo', requireOperatore, (req, res) => {
  res.render('operatore/profilo', { title: 'Il mio profilo', user: req.session.user });
});

// ── POST /operatore/profilo ────────────────────────────────────────────────
router.post('/operatore/profilo', requireOperatore, async (req, res) => {
  const { name, email, old_password, new_password, confirm_password } = req.body;

  if (!name || !name.trim()) {
    req.setFlash('error', 'Il nome non può essere vuoto.');
    return res.redirect('/operatore/profilo');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    req.setFlash('error', 'Indirizzo email non valido.');
    return res.redirect('/operatore/profilo');
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim(), req.session.user.id);
  if (existing) {
    req.setFlash('error', 'Email già in uso da un altro account.');
    return res.redirect('/operatore/profilo');
  }

  if (new_password) {
    if (!old_password) {
      req.setFlash('error', 'Inserisci la password attuale per cambiarla.');
      return res.redirect('/operatore/profilo');
    }
    if (new_password !== confirm_password) {
      req.setFlash('error', 'Le nuove password non coincidono.');
      return res.redirect('/operatore/profilo');
    }
    if (new_password.length < 6) {
      req.setFlash('error', 'La nuova password deve essere di almeno 6 caratteri.');
      return res.redirect('/operatore/profilo');
    }
    const dbUser = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.user.id);
    const match = await bcrypt.compare(old_password, dbUser.password_hash);
    if (!match) {
      req.setFlash('error', 'Password attuale non corretta.');
      return res.redirect('/operatore/profilo');
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
  res.redirect('/operatore/profilo');
});

module.exports = router;
