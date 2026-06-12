'use strict';
const express    = require('express');
const bcrypt     = require('bcrypt');
const { requireUtente } = require('../middleware/auth');
const ticketRepo   = require('../repositories/tickets.repo');
const userRepo     = require('../repositories/users.repo');
const emailService = require('../services/email.service');

const router = express.Router();

const CATEGORIES = ['tecnico', 'account', 'fatturazione', 'altro'];
const PRIORITIES = ['bassa', 'media', 'alta', 'urgente'];

/**
 * Questa route è responsabile di visualizzare l'elenco completo dei ticket che sono stati
 * aperti dall'utente correntemente loggato. I dati vengono recuperati dal database e
 * ad ogni ticket viene aggiunta una numerazione progressiva, utile per mostrare una tabella
 * ordinata e facilmente consultabile sul frontend.
 */
router.get('/tickets', requireUtente, (req, res) => {
  const tickets = ticketRepo.findByUserId(res.locals.currentUser.id);
  const total = tickets.length;
  const mappedTickets = tickets.map((t, index) => ({
    ...t,
    userIndex: index + 1
  }));
  res.render('utente/list', { title: 'I miei ticket', tickets: mappedTickets });
});

/**
 * Prepara e mostra il modulo HTML necessario per l'inserimento di un nuovo ticket.
 * Poiché solo i clienti standard (utenti) dovrebbero avere la necessità di aprire ticket,
 * la route effettua un controllo di sicurezza sul ruolo: operatori e admin verranno bloccati
 * con un messaggio di errore e reindirizzati.
 */
router.get('/tickets/new', requireUtente, (req, res) => {
  if (res.locals.currentUser.role !== 'utente') {
    req.setFlash('error', 'Solo gli utenti possono aprire ticket.');
    return res.redirect('/tickets');
  }
  res.render('utente/new', {
    title: 'Apri nuovo ticket',
    categories: CATEGORIES,
    priorities: PRIORITIES,
  });
});

/**
 * Questo endpoint riceve i dati del form di apertura ticket e li processa.
 * Esegue una validazione stringente su titolo, descrizione, categoria e priorità.
 * Se tutto è corretto, seleziona in automatico l'operatore attualmente più scarico (con meno ticket),
 * gli assegna la nuova richiesta, salva tutto a database e invia all'utente un'email di conferma.
 */
router.post('/tickets', requireUtente, (req, res) => {
  if (res.locals.currentUser.role !== 'utente') {
    req.setFlash('error', 'Solo gli utenti possono aprire ticket.');
    return res.redirect('/tickets');
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

  const operatorId = userRepo.getOperatorWithFewestTickets();
  const newTicketId = ticketRepo.createTicket(res.locals.currentUser.id, title.trim(), description.trim(), category, priority, operatorId);

  emailService.sendTicketCreatedEmail(res.locals.currentUser.email, newTicketId, title.trim()).catch(() => {});

  req.setFlash('success', 'Ticket aperto con successo!');
  res.redirect('/tickets');
});

/**
 * Mostra la pagina di dettaglio di un singolo ticket selezionato dall'utente.
 * In questa vista non viene caricato solo il ticket stesso, ma vengono agglomerati
 * anche tutti i messaggi scambiati, lo storico degli stati attraversati e, se presente,
 * l'eventuale valutazione finale rilasciata dall'utente sul servizio.
 */
router.get('/tickets/:id', requireUtente, (req, res, next) => {
  const ticketId = parseInt(req.params.id, 10);
  if (isNaN(ticketId)) return next();

  const ticket = ticketRepo.findDetailById(ticketId);
  if (!ticket) return next();
  if (ticket.user_id !== res.locals.currentUser.id) {
    req.setFlash('error', 'Non puoi visualizzare questo ticket.');
    return res.redirect('/tickets');
  }

  const comments = ticketRepo.getPublicComments(ticketId)
    .map(c => ({ ...c, isOwn: c.user_id === res.locals.currentUser.id }));
  const history  = ticketRepo.getHistory(ticketId);
  const rating   = ticketRepo.getRating(ticketId);

  if (rating) {
    rating.starsArr = Array.from({ length: 5 }, (_, i) => ({ filled: i < rating.score }));
  }

  res.render('utente/detail', {
    title: ticket.title,
    ticket, comments, history, rating,
    canClose:   ticket.status === 'risolto' && !rating,
    canReopen:  ticket.status === 'chiuso',
    canComment: ticket.status !== 'chiuso',
  });
});

/**
 * Gestisce l'inserimento di una nuova risposta da parte dell'utente all'interno del ticket.
 * Verifica che il ticket non sia chiuso, poiché in quel caso non sono ammessi nuovi messaggi.
 * Se l'inserimento va a buon fine, il sistema si occupa di avvisare immediatamente tramite email
 * l'operatore assegnato, così che possa prendere visione dell'aggiornamento.
 */
router.post('/tickets/:id/comments', requireUtente, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket   = ticketRepo.findById(ticketId);

  if (!ticket || ticket.user_id !== res.locals.currentUser.id) {
    req.setFlash('error', 'Operazione non consentita.');
    return res.redirect('/tickets');
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

  ticketRepo.addComment(ticketId, res.locals.currentUser.id, content.trim(), 0);

  if (ticket.assigned_to) {
    const op = userRepo.findById(ticket.assigned_to);
    if (op) emailService.sendNewCommentEmail(op.email, ticketId, res.locals.currentUser.name, true).catch(() => {});
  }

  req.setFlash('success', 'Commento aggiunto.');
  res.redirect(`/tickets/${ticketId}`);
});

/**
 * Permette all'utente di chiudere definitivamente un ticket che l'operatore aveva marcato
 * come "risolto". In questa fase finale, all'utente viene anche offerta la possibilità
 * opzionale di lasciare un feedback sotto forma di punteggio a stelle (da 1 a 5)
 * accompagnato da un breve commento sul servizio ricevuto.
 */
router.post('/tickets/:id/chiudi', requireUtente, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket   = ticketRepo.findById(ticketId);

  if (!ticket || ticket.user_id !== res.locals.currentUser.id) {
    req.setFlash('error', 'Operazione non consentita.');
    return res.redirect('/tickets');
  }
  if (ticket.status !== 'risolto') {
    req.setFlash('error', 'Puoi chiudere solo ticket in stato risolto.');
    return res.redirect(`/tickets/${ticketId}`);
  }

  const score = parseInt(req.body.score, 10);
  const note  = req.body.note ? req.body.note.trim() || null : null;

  ticketRepo.closeTicket(ticketId, res.locals.currentUser.id, score, note);
  req.setFlash('success', 'Ticket chiuso. Grazie per la valutazione!');
  res.redirect(`/tickets/${ticketId}`);
});

/**
 * Se l'utente dovesse accorgersi che un problema segnalato come "chiuso" in realtà
 * persiste o si è ripresentato, questa route gli consente di forzarne la riapertura.
 * Lo stato del ticket tornerà ad essere "aperto" in modo che l'operatore debba lavorarci di nuovo.
 */
router.post('/tickets/:id/riapri', requireUtente, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket   = ticketRepo.findById(ticketId);

  if (!ticket || ticket.user_id !== res.locals.currentUser.id) {
    req.setFlash('error', 'Operazione non consentita.');
    return res.redirect('/tickets');
  }
  if (ticket.status !== 'chiuso') {
    req.setFlash('error', 'Puoi riaprire solo ticket chiusi.');
    return res.redirect(`/tickets/${ticketId}`);
  }

  ticketRepo.reopenTicket(ticketId, res.locals.currentUser.id);
  req.setFlash('success', 'Ticket riaperto con successo.');
  res.redirect(`/tickets/${ticketId}`);
});

/**
 * Mostra la pagina personale dove l'utente può visualizzare e gestire i dati 
 * relativi al proprio account, come nome, email e password.
 */
router.get('/profilo', requireUtente, (req, res) => {
  if (res.locals.currentUser.role !== 'utente') {
    return res.redirect(`/${res.locals.currentUser.role}/profilo`);
  }
  res.render('utente/profilo', { title: 'Il mio profilo', user: res.locals.currentUser });
});

/**
 * Processa il modulo di aggiornamento dei dati del profilo. Se i campi sono validi
 * (come un'email corretta e non duplicata nel sistema), le informazioni vengono salvate.
 * In caso di cambio password, il sistema verificherà la vecchia password e cripterà la nuova.
 */
router.post('/profilo', requireUtente, async (req, res) => {
  if (res.locals.currentUser.role !== 'utente') {
    req.setFlash('error', 'Operazione non consentita.');
    return res.redirect('/tickets');
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

  const existing = userRepo.findIdByEmailExcluding(email.trim(), res.locals.currentUser.id);
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
    const dbUser = userRepo.findPasswordHashById(res.locals.currentUser.id);
    const match  = await bcrypt.compare(old_password, dbUser.password_hash);
    if (!match) {
      req.setFlash('error', 'Password attuale non corretta.');
      return res.redirect('/profilo');
    }
    const newHash = await bcrypt.hash(new_password, 10);
    userRepo.updateUserNameEmailPassword(res.locals.currentUser.id, name.trim(), email.trim(), newHash);
  } else {
    userRepo.updateUserNameEmail(res.locals.currentUser.id, name.trim(), email.trim());
  }

  req.setFlash('success', 'Profilo aggiornato con successo.');
  res.redirect('/profilo');
});

module.exports = router;
