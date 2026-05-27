'use strict';
const express    = require('express');
const bcrypt     = require('bcrypt');
const { requireOperatore } = require('../middleware/auth');
const ticketRepo = require('../repositories/tickets.repo');
const userRepo   = require('../repositories/users.repo');

const router = express.Router();

const VALID_PRIORITY = ['bassa', 'media', 'alta', 'urgente'];

// ── GET /operatore/dashboard ──────────────────────────────────────────────────
router.get('/operatore/dashboard', requireOperatore, (req, res) => {
  const opId = req.session.user.id;

  const statusRows = ticketRepo.getStatusCountsByOperator(opId);
  const counts = { aperto: 0, in_corso: 0, risolto: 0, chiuso: 0 };
  statusRows.forEach(r => { counts[r.status] = r.n; });

  const activeTickets     = ticketRepo.getActiveTicketsByOperator(opId);
  const resolvedThisMonth = ticketRepo.getResolvedThisMonth(opId);
  const avgRating         = ticketRepo.getAvgRatingByOperator(opId);
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

// ── GET /operatore/tickets ────────────────────────────────────────────────────
router.get('/operatore/tickets', requireOperatore, (req, res) => {
  const { status, priority, category, search } = req.query;

  const tickets = ticketRepo.filterOperatorTickets(req.session.user.id, { status, priority, category, search });

  res.render('operatore/list', {
    title: 'I miei ticket',
    tickets,
    filters: { status: status || '', priority: priority || '', category: category || '', search: search || '' },
    hasFilters: !!(status || priority || category || search),
  });
});

// ── GET /operatore/tickets/:id ────────────────────────────────────────────────
router.get('/operatore/tickets/:id', requireOperatore, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  if (isNaN(ticketId)) return res.status(404).render('error', { title: 'Non trovato', message: 'Ticket non trovato.' });

  const ticket = ticketRepo.findDetailById(ticketId);
  if (!ticket) return res.status(404).render('error', { title: 'Non trovato', message: 'Ticket non trovato.' });
  if (ticket.assigned_to !== req.session.user.id) {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Questo ticket non ti è assegnato.' });
  }

  const comments = ticketRepo.getAllComments(ticketId).map(c => ({
    ...c,
    isOwn: !c.is_internal && c.user_id === req.session.user.id,
  }));
  const history = ticketRepo.getHistory(ticketId);
  const rating  = ticketRepo.getRating(ticketId);
  if (rating) {
    rating.starsArr = Array.from({ length: 5 }, (_, i) => ({ filled: i < rating.score }));
  }

  res.render('operatore/ticket-detail', {
    title: ticket.title,
    ticket, comments, history, rating,
    canEditPriority: !['risolto', 'chiuso'].includes(ticket.status),
  });
});

// ── POST /operatore/tickets/:id/status ────────────────────────────────────────
router.post('/operatore/tickets/:id/status', requireOperatore, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket   = ticketRepo.findById(ticketId);

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
  ticketRepo.updateTicketStatus(ticketId, req.session.user.id, ticket.status, new_status, now);
  req.setFlash('success', `Stato aggiornato a "${new_status}".`);
  res.redirect(`/operatore/tickets/${ticketId}`);
});

// ── POST /operatore/tickets/:id/priority ──────────────────────────────────────
router.post('/operatore/tickets/:id/priority', requireOperatore, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket   = ticketRepo.findById(ticketId);

  if (!ticket || ticket.assigned_to !== req.session.user.id) {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Operazione non consentita.' });
  }

  const { new_priority } = req.body;
  if (!VALID_PRIORITY.includes(new_priority)) {
    req.setFlash('error', 'Priorità non valida.');
    return res.redirect(`/operatore/tickets/${ticketId}`);
  }
  if (['risolto', 'chiuso'].includes(ticket.status)) {
    req.setFlash('error', 'Non è possibile modificare la priorità di un ticket già risolto o chiuso.');
    return res.redirect(`/operatore/tickets/${ticketId}`);
  }
  if (ticket.priority === new_priority) {
    req.setFlash('info', 'Il ticket ha già questa priorità.');
    return res.redirect(`/operatore/tickets/${ticketId}`);
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  ticketRepo.updateTicketPriority(ticketId, req.session.user.id, ticket.priority, new_priority, now);
  req.setFlash('success', `Priorità aggiornata a "${new_priority}".`);
  res.redirect(`/operatore/tickets/${ticketId}`);
});

// ── POST /operatore/tickets/:id/comments ──────────────────────────────────────
router.post('/operatore/tickets/:id/comments', requireOperatore, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket   = ticketRepo.findById(ticketId);

  if (!ticket || ticket.assigned_to !== req.session.user.id) {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Operazione non consentita.' });
  }

  const { content, is_internal: isInternalStr } = req.body;
  if (!content || !content.trim() || content.trim().length > 1000) {
    req.setFlash('error', 'Il messaggio non può essere vuoto o superare 1000 caratteri.');
    return res.redirect(`/operatore/tickets/${ticketId}`);
  }

  const is_internal = isInternalStr === '1' ? 1 : 0;
  ticketRepo.addComment(ticketId, req.session.user.id, content.trim(), is_internal);
  req.setFlash('success', is_internal ? 'Nota interna aggiunta.' : 'Risposta inviata al cliente.');
  res.redirect(`/operatore/tickets/${ticketId}`);
});

// ── GET /operatore/profilo ────────────────────────────────────────────────────
router.get('/operatore/profilo', requireOperatore, (req, res) => {
  res.render('operatore/profilo', { title: 'Il mio profilo', user: req.session.user });
});

// ── POST /operatore/profilo ───────────────────────────────────────────────────
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

  const existing = userRepo.findIdByEmailExcluding(email.trim(), req.session.user.id);
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
    const dbUser = userRepo.findPasswordHashById(req.session.user.id);
    const match  = await bcrypt.compare(old_password, dbUser.password_hash);
    if (!match) {
      req.setFlash('error', 'Password attuale non corretta.');
      return res.redirect('/operatore/profilo');
    }
    const newHash = await bcrypt.hash(new_password, 10);
    userRepo.updateUserNameEmailPassword(req.session.user.id, name.trim(), email.trim(), newHash);
  } else {
    userRepo.updateUserNameEmail(req.session.user.id, name.trim(), email.trim());
  }

  req.session.user = { ...req.session.user, name: name.trim(), email: email.trim() };
  req.setFlash('success', 'Profilo aggiornato con successo.');
  res.redirect('/operatore/profilo');
});

module.exports = router;
