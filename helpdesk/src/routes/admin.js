'use strict';
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/db');
const { requireAdmin } = require('../middleware/auth');
const { getOperatorWithFewestTickets } = require('../helpers/operators');

const router = express.Router();
router.use(requireAdmin);

const CATEGORIES = ['tecnico', 'account', 'fatturazione', 'altro'];
const PRIORITIES = ['bassa', 'media', 'alta', 'urgente'];
const STATUSES   = ['aperto', 'in_corso', 'risolto', 'chiuso'];

// ── Dashboard ──────────────────────────────────────────────────────────────
router.get('/admin/dashboard', (req, res) => {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'aperto'   THEN 1 ELSE 0 END) AS aperto,
      SUM(CASE WHEN status = 'in_corso' THEN 1 ELSE 0 END) AS in_corso,
      SUM(CASE WHEN status = 'risolto'  THEN 1 ELSE 0 END) AS risolto,
      SUM(CASE WHEN status = 'chiuso'   THEN 1 ELSE 0 END) AS chiuso
    FROM tickets
  `).get();

  const userCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN role = 'utente'    THEN 1 ELSE 0 END) AS utenti,
      SUM(CASE WHEN role = 'operatore' THEN 1 ELSE 0 END) AS operatori
    FROM users WHERE role != 'admin'
  `).get();

  const unassigned = db.prepare(`
    SELECT t.id, t.title, t.category, t.priority, t.status, t.created_at,
           u.name AS user_name
    FROM tickets t
    JOIN users u ON u.id = t.user_id
    WHERE t.assigned_to IS NULL AND t.status NOT IN ('risolto', 'chiuso')
    ORDER BY CASE t.priority WHEN 'urgente' THEN 4 WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC,
             t.created_at ASC
    LIMIT 10
  `).all();

  const workload = db.prepare(`
    SELECT u.id, u.name,
           COUNT(t.id) AS active_tickets
    FROM users u
    LEFT JOIN tickets t ON t.assigned_to = u.id AND t.status NOT IN ('risolto', 'chiuso')
    WHERE u.role = 'operatore'
    GROUP BY u.id
    ORDER BY active_tickets DESC
  `).all();

  const recentTickets = db.prepare(`
    SELECT t.id, t.title, t.category, t.priority, t.status, t.created_at,
           u.name AS user_name, op.name AS operator_name
    FROM tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN users op ON op.id = t.assigned_to
    ORDER BY t.created_at DESC
    LIMIT 5
  `).all();

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    counts, userCounts, unassigned, workload, recentTickets,
  });
});

// ── Ticket list ────────────────────────────────────────────────────────────
router.get('/admin/tickets', (req, res) => {
  const { status, priority, category, assigned_to, search } = req.query;
  const operators = db.prepare(`SELECT id, name FROM users WHERE role = 'operatore' ORDER BY name`).all();

  const conditions = [];
  const params = [];

  if (status)      { conditions.push('t.status = ?');      params.push(status); }
  if (priority)    { conditions.push('t.priority = ?');    params.push(priority); }
  if (category)    { conditions.push('t.category = ?');    params.push(category); }
  if (assigned_to === 'null') {
    conditions.push('t.assigned_to IS NULL');
  } else if (assigned_to) {
    conditions.push('t.assigned_to = ?');
    params.push(Number(assigned_to));
  }
  if (search && search.trim()) {
    conditions.push('t.title LIKE ?');
    params.push(`%${search.trim()}%`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const tickets = db.prepare(`
    SELECT t.id, t.title, t.category, t.priority, t.status, t.created_at,
           u.name AS user_name, op.name AS operator_name
    FROM tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN users op ON op.id = t.assigned_to
    ${where}
    ORDER BY CASE t.priority WHEN 'urgente' THEN 4 WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC,
             t.created_at DESC
  `).all(...params);

  res.render('admin/list', {
    title: 'Tutti i ticket',
    tickets, operators, CATEGORIES, PRIORITIES, STATUSES,
    activeFilters: { status: status || '', priority: priority || '', category: category || '', assigned_to: assigned_to || '', search: search || '' },
  });
});

// ── Ticket detail ──────────────────────────────────────────────────────────
router.get('/admin/tickets/:id', (req, res) => {
  const ticket = db.prepare(`
    SELECT t.*, u.name AS user_name, u.email AS user_email,
           op.name AS operator_name
    FROM tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN users op ON op.id = t.assigned_to
    WHERE t.id = ?
  `).get(req.params.id);
  if (!ticket) return res.status(404).render('error', { title: 'Ticket non trovato', message: 'Il ticket non esiste.' });

  const comments = db.prepare(`
    SELECT c.*, u.name AS author_name, u.role AS author_role
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.ticket_id = ?
    ORDER BY c.created_at ASC
  `).all(req.params.id);

  const history = db.prepare(`
    SELECT h.*, u.name AS changed_by_name
    FROM status_history h JOIN users u ON u.id = h.changed_by
    WHERE h.ticket_id = ?
    ORDER BY h.changed_at ASC
  `).all(req.params.id);

  const operators = db.prepare(`SELECT id, name FROM users WHERE role = 'operatore' ORDER BY name`).all();

  const rating = db.prepare(`SELECT * FROM ratings WHERE ticket_id = ?`).get(req.params.id);
  if (rating) {
    rating.starsArr = [1,2,3,4,5].map(n => n <= rating.score);
  }

  res.render('admin/ticket-detail', {
    title: `Ticket #${ticket.id}`,
    ticket, comments, history, operators, rating,
    STATUSES, PRIORITIES,
    canEditPriority: !['risolto', 'chiuso'].includes(ticket.status),
  });
});

// POST actions on a ticket
router.post('/admin/tickets/:id/status', (req, res) => {
  const { status } = req.body;
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).render('error', { title: 'Ticket non trovato', message: '' });

  if (STATUSES.includes(status) && status !== ticket.status) {
    db.prepare('UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status, ticket.id);
    db.prepare('INSERT INTO status_history (ticket_id, changed_by, event_type, old_value, new_value) VALUES (?, ?, ?, ?, ?)')
      .run(ticket.id, req.session.user.id, 'status', ticket.status, status);
  }
  req.setFlash('success', 'Stato aggiornato.');
  res.redirect(`/admin/tickets/${ticket.id}`);
});

router.post('/admin/tickets/:id/assegna', (req, res) => {
  const { operator_id } = req.body;
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).render('error', { title: 'Ticket non trovato', message: '' });

  const oldOp = ticket.assigned_to
    ? db.prepare('SELECT name FROM users WHERE id = ?').get(ticket.assigned_to)
    : null;
  const oldOpName = oldOp ? oldOp.name : 'Non assegnato';

  const newOpId = operator_id ? Number(operator_id) : null;
  const newOp = newOpId ? db.prepare('SELECT name FROM users WHERE id = ?').get(newOpId) : null;
  const newOpName = newOp ? newOp.name : 'Non assegnato';

  db.prepare('UPDATE tickets SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(newOpId, ticket.id);

  db.prepare('INSERT INTO status_history (ticket_id, changed_by, event_type, old_value, new_value) VALUES (?, ?, ?, ?, ?)')
    .run(ticket.id, req.session.user.id, 'assign', oldOpName, newOpName);

  if (ticket.status === 'aperto' && newOpId) {
    db.prepare('UPDATE tickets SET status = \'in_corso\', updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(ticket.id);
    db.prepare('INSERT INTO status_history (ticket_id, changed_by, event_type, old_value, new_value) VALUES (?, ?, ?, ?, ?)')
      .run(ticket.id, req.session.user.id, 'status', 'aperto', 'in_corso');
  }
  req.setFlash('success', 'Operatore aggiornato.');
  res.redirect(`/admin/tickets/${ticket.id}`);
});

router.post('/admin/tickets/:id/priorita', (req, res) => {
  const { priority } = req.body;
  if (!PRIORITIES.includes(priority)) return res.redirect(`/admin/tickets/${req.params.id}`);

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).render('error', { title: 'Ticket non trovato', message: '' });

  if (['risolto', 'chiuso'].includes(ticket.status)) {
    req.setFlash('error', 'Non è possibile modificare la priorità di un ticket già risolto o chiuso.');
    return res.redirect(`/admin/tickets/${req.params.id}`);
  }

  db.prepare('UPDATE tickets SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(priority, req.params.id);

  db.prepare('INSERT INTO status_history (ticket_id, changed_by, event_type, old_value, new_value) VALUES (?, ?, ?, ?, ?)')
    .run(ticket.id, req.session.user.id, 'priority', ticket.priority, priority);

  req.setFlash('success', 'Priorità aggiornata.');
  res.redirect(`/admin/tickets/${req.params.id}`);
});

router.post('/admin/tickets/:id/commenti', (req, res) => {
  const { body, is_internal } = req.body;
  if (!body || !body.trim()) {
    req.setFlash('error', 'Il commento non può essere vuoto.');
    return res.redirect(`/admin/tickets/${req.params.id}`);
  }
  db.prepare('INSERT INTO comments (ticket_id, user_id, content, is_internal) VALUES (?, ?, ?, ?)')
    .run(req.params.id, req.session.user.id, body.trim(), is_internal === '1' ? 1 : 0);
  req.setFlash('success', 'Commento aggiunto.');
  res.redirect(`/admin/tickets/${req.params.id}`);
});

router.post('/admin/tickets/:id/auto-assign', (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).render('error', { title: 'Ticket non trovato', message: '' });

  const operatorId = getOperatorWithFewestTickets();
  if (!operatorId) {
    req.setFlash('error', 'Nessun operatore disponibile nel sistema.');
    return res.redirect(`/admin/tickets/${ticket.id}`);
  }

  const oldOp = ticket.assigned_to
    ? db.prepare('SELECT name FROM users WHERE id = ?').get(ticket.assigned_to)
    : null;
  const newOp = db.prepare('SELECT name FROM users WHERE id = ?').get(operatorId);

  db.prepare('UPDATE tickets SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(operatorId, ticket.id);

  db.prepare('INSERT INTO status_history (ticket_id, changed_by, event_type, old_value, new_value) VALUES (?, ?, ?, ?, ?)')
    .run(ticket.id, req.session.user.id, 'assign', oldOp ? oldOp.name : 'Non assegnato', newOp.name);

  if (ticket.status === 'aperto') {
    db.prepare('UPDATE tickets SET status = \'in_corso\', updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(ticket.id);
    db.prepare('INSERT INTO status_history (ticket_id, changed_by, event_type, old_value, new_value) VALUES (?, ?, ?, ?, ?)')
      .run(ticket.id, req.session.user.id, 'status', 'aperto', 'in_corso');
  }
  req.setFlash('success', `Ticket assegnato automaticamente a ${newOp.name}.`);
  res.redirect(`/admin/tickets/${ticket.id}`);
});

// ── User management ────────────────────────────────────────────────────────
router.get('/admin/utenti', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.created_at,
           COUNT(t.id) AS ticket_count
    FROM users u
    LEFT JOIN tickets t ON t.user_id = u.id
    WHERE u.role != 'admin'
    GROUP BY u.id
    ORDER BY u.role, u.name
  `).all();
  res.render('admin/utenti', { title: 'Gestione utenti', users });
});

router.get('/admin/utenti/nuovo', (req, res) => {
  res.render('admin/utente-form', { title: 'Nuovo utente', user: null, isNew: true });
});

router.post('/admin/utenti', async (req, res) => {
  const { name, email, password, role } = req.body;
  const errors = [];
  if (!name  || !name.trim())  errors.push('Nome obbligatorio.');
  if (!email || !email.trim()) errors.push('Email obbligatoria.');
  if (!password || password.length < 6) errors.push('Password di almeno 6 caratteri.');
  if (!['utente', 'operatore'].includes(role)) errors.push('Ruolo non valido.');

  if (errors.length) {
    return res.render('admin/utente-form', {
      title: 'Nuovo utente', user: { name, email, role }, isNew: true, errors,
    });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (existing) {
    return res.render('admin/utente-form', {
      title: 'Nuovo utente', user: { name, email, role }, isNew: true,
      errors: ['Email già registrata.'],
    });
  }

  const hash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name.trim(), email.trim().toLowerCase(), hash, role);
  req.setFlash('success', 'Utente creato.');
  res.redirect('/admin/utenti');
});

router.get('/admin/utenti/:id/modifica', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND role != ?').get(req.params.id, 'admin');
  if (!user) return res.status(404).render('error', { title: 'Utente non trovato', message: '' });
  res.render('admin/utente-form', { title: 'Modifica utente', user, isNew: false });
});

router.post('/admin/utenti/:id', async (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND role != ?').get(req.params.id, 'admin');
  if (!existing) return res.status(404).render('error', { title: 'Utente non trovato', message: '' });

  const { name, email, role, new_password } = req.body;
  const errors = [];
  if (!name  || !name.trim())  errors.push('Nome obbligatorio.');
  if (!email || !email.trim()) errors.push('Email obbligatoria.');
  if (!['utente', 'operatore'].includes(role)) errors.push('Ruolo non valido.');

  if (errors.length) {
    return res.render('admin/utente-form', {
      title: 'Modifica utente',
      user: { ...existing, name, email, role }, isNew: false, errors,
    });
  }

  const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim().toLowerCase(), existing.id);
  if (dup) {
    return res.render('admin/utente-form', {
      title: 'Modifica utente',
      user: { ...existing, name, email, role }, isNew: false,
      errors: ['Email già in uso da un altro utente.'],
    });
  }

  let hash = existing.password_hash;
  if (new_password && new_password.length >= 6) {
    hash = await bcrypt.hash(new_password, 12);
  }

  db.prepare('UPDATE users SET name = ?, email = ?, password_hash = ?, role = ? WHERE id = ?')
    .run(name.trim(), email.trim().toLowerCase(), hash, role, existing.id);
  req.setFlash('success', 'Utente aggiornato.');
  res.redirect('/admin/utenti');
});

// ── Profilo admin ──────────────────────────────────────────────────────────
router.get('/admin/profilo', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  res.render('admin/profilo', { title: 'Il mio profilo', utente: user });
});

module.exports = router;
