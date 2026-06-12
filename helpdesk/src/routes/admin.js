'use strict';
const express    = require('express');
const bcrypt     = require('bcrypt');
const { requireAdmin } = require('../middleware/auth');
const ticketRepo = require('../repositories/tickets.repo');
const userRepo   = require('../repositories/users.repo');
const emailService = require('../services/email.service');

const router = express.Router();
router.use(requireAdmin);

const CATEGORIES = ['tecnico', 'account', 'fatturazione', 'altro'];
const PRIORITIES = ['bassa', 'media', 'alta', 'urgente'];
const STATUSES   = ['aperto', 'in_corso', 'risolto', 'chiuso'];

// Raccoglie e mostra i dati statistici principali sulla Dashboard dell'Amministratore.
// Mostra il numero totale dei ticket, i ticket non assegnati e il carico di lavoro degli operatori.
router.get('/admin/dashboard', (req, res) => {
  const counts        = ticketRepo.getTicketCountsAdmin();
  const unassigned    = ticketRepo.getUnassignedTickets();
  const workload      = ticketRepo.getOperatorWorkload();
  const recentTickets = ticketRepo.getRecentTickets();

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    counts, unassigned, workload, recentTickets,
  });
});

// Visualizza l'elenco completo di tutti i ticket del sistema.
// Permette all'amministratore di filtrare per stato, priorità, categoria, operatore assegnato o testo.
router.get('/admin/tickets', (req, res) => {
  const { status, priority, category, assigned_to, search, sort } = req.query;
  const operators = userRepo.listOperators();
  const filters   = { status, priority, category, assigned_to, search, sort: sort || 'urgenza' };
  const tickets   = ticketRepo.filterAdminTickets(filters);

  res.render('admin/list', {
    title: 'Tutti i ticket',
    tickets, operators, CATEGORIES, PRIORITIES, STATUSES,
    activeFilters: {
      status: status || '', priority: priority || '', category: category || '',
      assigned_to: assigned_to || '', search: search || '', sort: sort || 'urgenza',
    },
  });
});

// Mostra i dettagli completi di uno specifico ticket all'amministratore.
// Include tutti i commenti, lo storico delle modifiche, la valutazione finale e i controlli di gestione.
router.get('/admin/tickets/:id', (req, res, next) => {
  const ticket = ticketRepo.findAdminDetailById(req.params.id);
  if (!ticket) return next();

  const comments  = ticketRepo.getAllComments(req.params.id);
  const history   = ticketRepo.getHistory(req.params.id);
  const operators = userRepo.listOperators();
  const rating    = ticketRepo.getRating(req.params.id);
  if (rating) {
    rating.starsArr = [1,2,3,4,5].map(n => n <= rating.score);
  }

  res.render('admin/ticket-detail', {
    ticket, comments, history, operators, rating,
    STATUSES, PRIORITIES,
    canEditPriority: !['risolto', 'chiuso'].includes(ticket.status),
    isClosed: ticket.status === 'chiuso',
  });
});

// Aggiorna lo stato di un ticket.
// Invia un'email all'utente creatore del ticket per notificargli il cambio di stato.
router.post('/admin/tickets/:id/status', (req, res, next) => {
  const { status } = req.body;
  const ticket = ticketRepo.findById(req.params.id);
  if (!ticket) return next();

  if (ticket.status === 'chiuso') {
    req.setFlash('error', 'Ticket chiuso. Modifica non consentita.');
    return res.redirect(`/admin/tickets/${ticket.id}`);
  }

  if (STATUSES.includes(status) && status !== ticket.status) {
    const oldStatus = ticket.status;
    ticketRepo.updateAdminStatus(ticket.id, res.locals.currentUser.id, oldStatus, status);
    const owner = userRepo.findById(ticket.user_id);
    if (owner) emailService.sendStatusChangedEmail(owner.email, ticket.id, oldStatus, status).catch(() => {});
  }
  req.setFlash('success', 'Stato aggiornato.');
  res.redirect(`/admin/tickets/${ticket.id}`);
});

// Assegna o riassegna manualmente un ticket a uno specifico operatore.
// Notifica sia l'operatore designato sia l'utente creatore tramite email.
router.post('/admin/tickets/:id/assegna', (req, res, next) => {
  const { operator_id } = req.body;
  const ticket = ticketRepo.findById(req.params.id);
  if (!ticket) return next();

  if (ticket.status === 'chiuso') {
    req.setFlash('error', 'Ticket chiuso. Assegnazione non consentita.');
    return res.redirect(`/admin/tickets/${ticket.id}`);
  }

  const oldOp     = ticket.assigned_to ? userRepo.findNameById(ticket.assigned_to) : null;
  const oldOpName = oldOp ? oldOp.name : 'Non assegnato';
  const newOpId   = operator_id ? Number(operator_id) : null;
  const newOp     = newOpId ? userRepo.findNameById(newOpId) : null;
  const newOpName = newOp ? newOp.name : 'Non assegnato';

  ticketRepo.assignTicket(ticket.id, res.locals.currentUser.id, newOpId, oldOpName, newOpName, ticket.status);

  if (newOpId) {
    const opUser    = userRepo.findById(newOpId);
    const tickOwner = userRepo.findById(ticket.user_id);
    if (opUser)    emailService.sendTicketAssignedEmail(opUser.email,    ticket.id, ticket.title, false).catch(() => {});
    if (tickOwner) emailService.sendTicketAssignedEmail(tickOwner.email, ticket.id, ticket.title, true).catch(() => {});
  }

  req.setFlash('success', 'Operatore aggiornato.');
  res.redirect(`/admin/tickets/${ticket.id}`);
});

// Modifica la priorità assegnata a un ticket.
// Non è consentito modificare la priorità se il ticket è già stato risolto o chiuso.
router.post('/admin/tickets/:id/priorita', (req, res, next) => {
  const { priority } = req.body;
  if (!PRIORITIES.includes(priority)) return res.redirect(`/admin/tickets/${req.params.id}`);

  const ticket = ticketRepo.findById(req.params.id);
  if (!ticket) return next();

  if (['risolto', 'chiuso'].includes(ticket.status)) {
    req.setFlash('error', 'Non è possibile modificare la priorità di un ticket già risolto o chiuso.');
    return res.redirect(`/admin/tickets/${req.params.id}`);
  }

  ticketRepo.updateAdminPriority(ticket.id, res.locals.currentUser.id, ticket.priority, priority);
  req.setFlash('success', 'Priorità aggiornata.');
  res.redirect(`/admin/tickets/${req.params.id}`);
});

// Permette all'amministratore di inserire un nuovo commento.
// I commenti possono essere interni (visibili solo allo staff) o pubblici (visibili anche all'utente).
router.post('/admin/tickets/:id/commenti', (req, res) => {
  const { body, is_internal } = req.body;
  if (!body || !body.trim()) {
    req.setFlash('error', 'Il commento non può essere vuoto.');
    return res.redirect(`/admin/tickets/${req.params.id}`);
  }
  const ticketId = req.params.id;
  const ticket = ticketRepo.findById(ticketId);
  if (ticket && ticket.status === 'chiuso') {
    req.setFlash('error', 'Ticket chiuso. Commento non consentito.');
    return res.redirect(`/admin/tickets/${ticketId}`);
  }

  ticketRepo.addComment(ticketId, res.locals.currentUser.id, body.trim(), is_internal === '1' ? 1 : 0);
  req.setFlash('success', 'Commento aggiunto.');
  res.redirect(`/admin/tickets/${ticketId}`);
});

// Assegna automaticamente il ticket all'operatore che ha meno ticket attivi in carico al momento.
router.post('/admin/tickets/:id/auto-assign', (req, res, next) => {
  const ticket = ticketRepo.findById(req.params.id);
  if (!ticket) return next();

  if (ticket.status === 'chiuso') {
    req.setFlash('error', 'Ticket chiuso. Assegnazione automatica non consentita.');
    return res.redirect(`/admin/tickets/${ticket.id}`);
  }

  const operatorId = userRepo.getOperatorWithFewestTickets();
  if (!operatorId) {
    req.setFlash('error', 'Nessun operatore disponibile nel sistema.');
    return res.redirect(`/admin/tickets/${ticket.id}`);
  }

  const oldOp     = ticket.assigned_to ? userRepo.findNameById(ticket.assigned_to) : null;
  const newOp     = userRepo.findNameById(operatorId);
  const oldOpName = oldOp ? oldOp.name : 'Non assegnato';

  ticketRepo.assignTicket(ticket.id, res.locals.currentUser.id, operatorId, oldOpName, newOp.name, ticket.status);

  const opUser    = userRepo.findById(operatorId);
  const tickOwner = userRepo.findById(ticket.user_id);
  if (opUser)    emailService.sendTicketAssignedEmail(opUser.email,    ticket.id, ticket.title, false).catch(() => {});
  if (tickOwner) emailService.sendTicketAssignedEmail(tickOwner.email, ticket.id, ticket.title, true).catch(() => {});

  req.setFlash('success', `Ticket assegnato automaticamente a ${newOp.name}.`);
  res.redirect(`/admin/tickets/${ticket.id}`);
});

// Elenca tutti gli utenti registrati nel sistema.
// Restituisce anche il conteggio dei ticket associati a ciascun utente.
router.get('/admin/utenti', (req, res) => {
  const users = userRepo.listUsersWithTicketCount();
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

  const existing = userRepo.findIdByEmail(email.trim().toLowerCase());
  if (existing) {
    return res.render('admin/utente-form', {
      title: 'Nuovo utente', user: { name, email, role }, isNew: true,
      errors: ['Email già registrata.'],
    });
  }

  const hash = await bcrypt.hash(password, 12);
  userRepo.createUser(name.trim(), email.trim().toLowerCase(), hash, role);

  emailService.sendWelcomeEmail(email.trim().toLowerCase(), name.trim(), password).catch(() => {});

  req.setFlash('success', 'Utente creato.');
  res.redirect('/admin/utenti');
});

router.get('/admin/utenti/:id/modifica', (req, res, next) => {
  const user = userRepo.findByIdNotAdmin(req.params.id);
  if (!user) return next();
  res.render('admin/utente-form', { title: 'Modifica utente', user, isNew: false });
});

router.post('/admin/utenti/:id', async (req, res, next) => {
  const existing = userRepo.findByIdNotAdmin(req.params.id);
  if (!existing) return next();

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

  const dup = userRepo.findIdByEmailExcluding(email.trim().toLowerCase(), existing.id);
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

  userRepo.updateUserFull(existing.id, name.trim(), email.trim().toLowerCase(), hash, role);
  req.setFlash('success', 'Utente aggiornato.');
  res.redirect('/admin/utenti');
});

router.post('/admin/utenti/:id/elimina', (req, res, next) => {
  const user = userRepo.findByIdNotAdmin(req.params.id);
  if (!user) return next();

  if (userRepo.countUserTickets(user.id) > 0) {
    req.setFlash('error', 'Impossibile eliminare: l\'utente ha ticket associati.');
    return res.redirect('/admin/utenti');
  }
  if (userRepo.countUserComments(user.id) > 0) {
    req.setFlash('error', 'Impossibile eliminare: l\'utente ha commenti nel sistema.');
    return res.redirect('/admin/utenti');
  }
  if (userRepo.countUserHistory(user.id) > 0) {
    req.setFlash('error', 'Impossibile eliminare: l\'utente ha modifiche storiche associate.');
    return res.redirect('/admin/utenti');
  }

  userRepo.nullifyAssignedTo(user.id);
  userRepo.deleteUser(user.id);

  req.setFlash('success', `Utente "${user.name}" eliminato.`);
  res.redirect('/admin/utenti');
});

// Mostra il profilo personale dell'amministratore.
router.get('/admin/profilo', (req, res) => {
  const user = userRepo.findById(res.locals.currentUser.id);
  res.render('admin/profilo', { title: 'Il mio profilo', utente: user });
});

module.exports = router;
