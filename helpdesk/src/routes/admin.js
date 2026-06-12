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

/**
 * Questa route si occupa di aggregare e presentare tutti i dati statistici fondamentali
 * necessari per alimentare la Dashboard dell'Amministratore. Nello specifico, recupera
 * i conteggi globali dei ticket, individua quelli ancora non assegnati e calcola
 * in tempo reale il carico di lavoro attuale di ciascun operatore.
 */
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

/**
 * Visualizza l'archivio completo di tutti i ticket presenti all'interno del sistema.
 * Poiché il volume dei dati può essere elevato, la pagina fornisce all'amministratore
 * una serie di filtri avanzati: è possibile restringere la ricerca per stato, priorità,
 * categoria, operatore a cui è assegnato il ticket, o effettuando una ricerca testuale.
 */
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

/**
 * Questa vista fornisce all'amministratore una panoramica assoluta e dettagliata
 * su uno specifico ticket. Oltre ai dati di base, la pagina espone in chiaro
 * tutti i commenti (sia interni che pubblici), l'intera cronologia dei passaggi di stato,
 * i feedback lasciati dall'utente e i pulsanti per le azioni di gestione avanzate.
 */
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

/**
 * Gestisce l'aggiornamento manuale dello stato operativo di un ticket da parte
 * dell'amministratore. Se il nuovo stato è differente da quello attuale e il ticket non è chiuso,
 * la modifica viene salvata nel database e il cliente che ha aperto la segnalazione
 * viene immediatamente avvisato tramite l'invio di una notifica email.
 */
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

/**
 * Questo endpoint permette all'amministratore di prendere il controllo sulle assegnazioni,
 * potendo assegnare o riassegnare esplicitamente un ticket a uno specifico operatore
 * selezionato dal menù a tendina. Per garantire la trasparenza, il sistema notifica
 * via email sia il nuovo operatore incaricato sia il cliente finale.
 */
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

/**
 * Consente di ricalibrare l'urgenza di un ticket modificandone la priorità.
 * Per motivi di coerenza dei dati storici, non è permesso effettuare questa modifica
 * se il ticket ha già raggiunto uno stato di "risolto" o "chiuso", poiché la sua priorità
 * non avrebbe più alcun impatto reale sui flussi di lavoro.
 */
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

/**
 * Processa l'aggiunta di un nuovo commento testuale da parte dell'amministratore.
 * Una funzionalità chiave di questo endpoint è la gestione del flag 'is_internal',
 * che permette di distinguere tra messaggi diretti all'utente (pubblici) e
 * note private destinate esclusivamente alla consultazione da parte dello staff.
 */
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

/**
 * Esegue un'operazione di smistamento intelligente: individua automaticamente
 * l'operatore che in quel preciso momento risulta avere il minor numero di ticket
 * attivi a proprio carico e gli assegna la segnalazione in modo da bilanciare il lavoro.
 */
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

/**
 * Visualizza un elenco strutturato di tutti gli account attualmente registrati nel sistema.
 * Per facilitare la gestione, per ogni utente viene calcolato e mostrato anche il numero
 * totale di ticket associati, permettendo di identificare rapidamente gli utenti più attivi.
 */
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

/**
 * Mostra la schermata dedicata al profilo personale dell'amministratore,
 * dove quest'ultimo può prendere visione ed eventualmente modificare le proprie informazioni.
 */
router.get('/admin/profilo', (req, res) => {
  const user = userRepo.findById(res.locals.currentUser.id);
  res.render('admin/profilo', { title: 'Il mio profilo', utente: user });
});

module.exports = router;
