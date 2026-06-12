'use strict';
const express    = require('express');
const bcrypt     = require('bcrypt');
const { requireOperatore } = require('../middleware/auth');
const ticketRepo   = require('../repositories/tickets.repo');
const userRepo     = require('../repositories/users.repo');
const emailService = require('../services/email.service');

const router = express.Router();

const VALID_PRIORITY = ['bassa', 'media', 'alta', 'urgente'];

/**
 * Questa è la vista principale dell'area privata dell'operatore. Qui vengono
 * calcolati e presentati vari KPI (Key Performance Indicators) essenziali per 
 * monitorare il proprio rendimento: i ticket aperti divisi per stato, il totale 
 * di quelli risolti nel mese corrente e una sintesi della valutazione media ottenuta.
 */
router.get('/operatore/dashboard', requireOperatore, (req, res) => {
  const opId = res.locals.currentUser.id;

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

/**
 * Mostra l'elenco completo di tutte le richieste di supporto che sono state
 * direttamente prese in carico dall'operatore. Questa schermata fornisce anche
 * un sistema di filtraggio che permette di restringere la lista per stato,
 * priorità, categoria di appartenenza o effettuando una veloce ricerca testuale.
 */
router.get('/operatore/tickets', requireOperatore, (req, res) => {
  const { status, priority, category, search, sort } = req.query;

  const filters = { status, priority, category, search, sort: sort || 'urgenza' };
  const tickets = ticketRepo.filterOperatorTickets(res.locals.currentUser.id, filters);

  res.render('operatore/list', {
    title: 'I miei ticket',
    tickets,
    filters,
    hasFilters: !!(status || priority || category || search),
  });
});

/**
 * Quando l'operatore seleziona un ticket specifico, questa route ne mostra
 * ogni dettaglio. Viene recuperata l'intera catena dei messaggi, così come
 * lo storico degli eventi tecnici e, qualora l'utente abbia chiuso la pratica,
 * anche le eventuali valutazioni e feedback inseriti sul lavoro svolto.
 */
router.get('/operatore/tickets/:id', requireOperatore, (req, res, next) => {
  const ticketId = parseInt(req.params.id, 10);
  if (isNaN(ticketId)) return next();

  const ticket = ticketRepo.findDetailById(ticketId);
  if (!ticket) return next();
  if (ticket.assigned_to !== res.locals.currentUser.id) {
    req.setFlash('error', 'Questo ticket non ti è assegnato.');
    return res.redirect('/operatore/tickets');
  }

  const comments = ticketRepo.getAllComments(ticketId).map(c => ({
    ...c,
    isOwn: !c.is_internal && c.user_id === res.locals.currentUser.id,
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
    canEditStatus: ticket.status !== 'chiuso',
    isClosed: ticket.status === 'chiuso',
  });
});

/**
 * Questo endpoint serve all'operatore per far avanzare lo stato della pratica
 * (ad esempio dichiarandola "in_corso" oppure "risolto"). Oltre a salvare il
 * nuovo stato a database, il sistema registrerà l'operazione nello storico eventi
 * e informerà tempestivamente il cliente che c'è stato un aggiornamento.
 */
router.post('/operatore/tickets/:id/status', requireOperatore, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket   = ticketRepo.findById(ticketId);

  if (!ticket || ticket.assigned_to !== res.locals.currentUser.id) {
    req.setFlash('error', 'Operazione non consentita.');
    return res.redirect('/operatore/tickets');
  }

  if (ticket.status === 'chiuso') {
    req.setFlash('error', 'Non puoi modificare lo stato di un ticket chiuso. Solo l\'utente può riaprirlo.');
    return res.redirect(`/operatore/tickets/${ticketId}`);
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

  const oldStatus = ticket.status;
  ticketRepo.updateTicketStatus(ticketId, res.locals.currentUser.id, oldStatus, new_status);

  const owner = userRepo.findById(ticket.user_id);
  if (owner) emailService.sendStatusChangedEmail(owner.email, ticketId, oldStatus, new_status).catch(() => {});

  req.setFlash('success', `Stato aggiornato a "${new_status}".`);
  res.redirect(`/operatore/tickets/${ticketId}`);
});

/**
 * Se la gravità di una segnalazione dovesse cambiare nel corso dell'analisi,
 * l'operatore può utilizzare questo endpoint per scalarne la priorità. Tuttavia,
 * a fini di storico, la priorità viene bloccata e non può più essere alterata
 * una volta che la pratica è già considerata risolta o chiusa definitivamente.
 */
router.post('/operatore/tickets/:id/priority', requireOperatore, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket   = ticketRepo.findById(ticketId);

  if (!ticket || ticket.assigned_to !== res.locals.currentUser.id) {
    req.setFlash('error', 'Operazione non consentita.');
    return res.redirect('/operatore/tickets');
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

  ticketRepo.updateTicketPriority(ticketId, res.locals.currentUser.id, ticket.priority, new_priority);
  req.setFlash('success', `Priorità aggiornata a "${new_priority}".`);
  res.redirect(`/operatore/tickets/${ticketId}`);
});

/**
 * Consente l'aggiunta di messaggi alla conversazione del ticket. Un dettaglio 
 * fondamentale di questa route è la capacità di gestire le cosiddette "Note Interne":
 * flaggando l'apposita casella, l'operatore può scrivere appunti tecnici visibili
 * soltanto allo staff, senza che il cliente finale possa leggerli.
 */
router.post('/operatore/tickets/:id/comments', requireOperatore, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket   = ticketRepo.findById(ticketId);

  if (!ticket || ticket.assigned_to !== res.locals.currentUser.id) {
    req.setFlash('error', 'Operazione non consentita.');
    return res.redirect('/operatore/tickets');
  }

  if (ticket.status === 'chiuso') {
    req.setFlash('error', 'Il ticket è chiuso, non è possibile aggiungere commenti.');
    return res.redirect(`/operatore/tickets/${ticketId}`);
  }

  const { content, is_internal: isInternalStr } = req.body;
  if (!content || !content.trim() || content.trim().length > 1000) {
    req.setFlash('error', 'Il messaggio non può essere vuoto o superare 1000 caratteri.');
    return res.redirect(`/operatore/tickets/${ticketId}`);
  }

  const is_internal = isInternalStr === '1' ? 1 : 0;
  ticketRepo.addComment(ticketId, res.locals.currentUser.id, content.trim(), is_internal);

  if (!is_internal) {
    const owner = userRepo.findById(ticket.user_id);
    if (owner) emailService.sendNewCommentEmail(owner.email, ticketId, res.locals.currentUser.name, false).catch(() => {});
  }

  req.setFlash('success', is_internal ? 'Nota interna aggiunta.' : 'Risposta inviata al cliente.');
  res.redirect(`/operatore/tickets/${ticketId}`);
});

/**
 * Apre la schermata personale in cui l'operatore può visionare le proprie
 * informazioni di accesso, come il nome di sistema e l'indirizzo email.
 */
router.get('/operatore/profilo', requireOperatore, (req, res) => {
  res.render('operatore/profilo', { title: 'Il mio profilo', user: res.locals.currentUser });
});

/**
 * Endpoint che riceve le modifiche ai dati di profilo dell'operatore.
 * Gestisce l'aggiornamento dell'email (verificando che non sia già presa)
 * e, ove richiesto, gestisce il cambio password in modo sicuro controllando l'hash.
 */
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

  const existing = userRepo.findIdByEmailExcluding(email.trim(), res.locals.currentUser.id);
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
    const dbUser = userRepo.findPasswordHashById(res.locals.currentUser.id);
    const match  = await bcrypt.compare(old_password, dbUser.password_hash);
    if (!match) {
      req.setFlash('error', 'Password attuale non corretta.');
      return res.redirect('/operatore/profilo');
    }
    const newHash = await bcrypt.hash(new_password, 10);
    userRepo.updateUserNameEmailPassword(res.locals.currentUser.id, name.trim(), email.trim(), newHash);
  } else {
    userRepo.updateUserNameEmail(res.locals.currentUser.id, name.trim(), email.trim());
  }

  req.setFlash('success', 'Profilo aggiornato con successo.');
  res.redirect('/operatore/profilo');
});

module.exports = router;
