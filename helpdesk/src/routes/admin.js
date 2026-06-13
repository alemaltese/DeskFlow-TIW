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
  const { status, priority, category, assigned_to, sort } = req.query;
  const operators = userRepo.listOperators();
  const filters   = { status, priority, category, assigned_to, sort: sort || 'priorita' };
  const tickets   = ticketRepo.filterAdminTickets(filters);

  res.render('admin/list', {
    title: 'Tutti i Ticket',
    tickets, operators, CATEGORIES, PRIORITIES, STATUSES,
    activeFilters: {
      status: status || '', priority: priority || '', category: category || '',
      assigned_to: assigned_to || '', sort: sort || 'priorita',
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

  const comments  = ticketRepo.getComments(req.params.id);
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
  const { body } = req.body;
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

  ticketRepo.addComment(ticketId, res.locals.currentUser.id, body.trim());
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



module.exports = router;
