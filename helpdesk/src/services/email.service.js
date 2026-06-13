'use strict';

const nodemailer = require('nodemailer');

const user = process.env.EMAIL_USER || '';
const pass = process.env.EMAIL_PASS || '';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: user,
    pass: pass,
  },
});

const FROM = '"Helpdesk DeskFlow" <' + user + '>';

async function send(to, subject, text, html) {
  try {
    await transporter.sendMail({ from: FROM, to, subject, text, html });
    console.log('[email] sent to', to, '|', subject);
  } catch (err) {
    console.error('[email] send error:', err.message);
  }
}

function wrapHtml(title, content) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    .header { background-color: #2563eb; color: #ffffff; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: -0.5px; }
    .content { padding: 30px; line-height: 1.6; font-size: 16px; color: #374151; }
    .content h2 { margin-top: 0; color: #111827; font-size: 20px; margin-bottom: 20px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px; }
    .content p { margin-top: 0; margin-bottom: 16px; }
    .footer { background-color: #f9fafb; color: #6b7280; text-align: center; padding: 20px; font-size: 13px; border-top: 1px solid #e5e7eb; }
    .highlight { background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; border-radius: 4px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">DeskFlow</div>
    <div class="content">
      <h2>${title}</h2>
      ${content}
    </div>
    <div class="footer">
      Questo è un messaggio generato automaticamente.<br>Si prega di non rispondere a questa email.
    </div>
  </div>
</body>
</html>`;
}

const ticketRepo = require('../repositories/tickets.repo');

async function sendWelcomeEmail(userEmail, userName) {
  const subject = 'Benvenuto su DeskFlow';
  const text    = `Ciao ${userName},\n\nIl tuo account DeskFlow è stato creato con successo.\n\nBuon lavoro!`;
  
  const content = `<p>Ciao <strong>${userName}</strong>,</p>
                   <p>Siamo felici di darti il benvenuto! Il tuo account DeskFlow è stato creato con successo e ora puoi accedere alla piattaforma per inviare o gestire le tue richieste di assistenza.</p>`;
  
  await send(userEmail, subject, text, wrapHtml('Benvenuto a bordo!', content));
}

async function sendTicketCreatedEmail(userEmail, ticketId, title) {
  const userIndex = ticketRepo.getUserTicketIndex(ticketId);
  const subject = `Ticket #${userIndex} aperto con successo`;
  const text    = `Il tuo ticket "#${userIndex} - ${title}" è stato aperto con successo. Ti aggiorneremo sullo stato.`;
  
  const content = `<p>Abbiamo ricevuto la tua richiesta di assistenza.</p>
                   <div class="highlight"><strong>Ticket #${userIndex}</strong>: ${title}</div>
                   <p>Il nostro team se ne prenderà carico al più presto. Ti invieremo un'ulteriore notifica non appena ci saranno aggiornamenti, oppure se un operatore ti assegnerà il ticket.</p>`;
                   
  await send(userEmail, subject, text, wrapHtml(`Conferma apertura ticket #${userIndex}`, content));
}

async function sendTicketAssignedEmail(recipientEmail, ticketId, title, isToUser = false) {
  const displayId = isToUser ? ticketRepo.getUserTicketIndex(ticketId) : ticketId;
  const subject = isToUser
    ? `Il tuo ticket #${displayId} è in lavorazione`
    : `Nuovo Ticket #${displayId} assegnato a te`;
    
  const body = isToUser
    ? `Il tuo ticket "${title}" è stato appena assegnato a uno dei nostri operatori. Riceverai presto assistenza.`
    : `Ti è stato assegnato il ticket #${displayId}: "${title}". Accedi alla dashboard per gestirlo.`;
    
  const content = `<p>${body}</p>
                   <p>Puoi accedere in qualsiasi momento alla piattaforma per controllare i dettagli del ticket e rispondere con ulteriori informazioni.</p>`;
                   
  const headerTitle = isToUser ? `Ticket #${displayId} in gestione` : `Nuova Assegnazione: Ticket #${displayId}`;
  await send(recipientEmail, subject, body, wrapHtml(headerTitle, content));
}

async function sendStatusChangedEmail(userEmail, ticketId, oldStatus, newStatus) {
  const userIndex = ticketRepo.getUserTicketIndex(ticketId);
  const subject  = `Aggiornamento stato: Ticket #${userIndex}`;
  const rateNote = newStatus === 'risolto' ? '\n\nPuoi lasciare una valutazione accedendo al tuo ticket.' : '';
  const text     = `Lo stato del ticket #${userIndex} è cambiato da "${oldStatus}" a "${newStatus}".${rateNote}`;
  
  let content = `<p>Ci sono novità! Lo stato del tuo ticket <strong>#${userIndex}</strong> è stato aggiornato.</p>
                 <div class="highlight">
                   Stato precedente: <em>${oldStatus.toUpperCase()}</em><br>
                   Nuovo stato: <strong>${newStatus.toUpperCase()}</strong>
                 </div>`;
                 
  if (newStatus === 'risolto') {
    content += `<p>Il problema sembra essere stato risolto. Ti invitiamo ad accedere alla piattaforma per confermare la chiusura del ticket e, se lo desideri, lasciarci una valutazione sul supporto ricevuto!</p>`;
  }
  
  await send(userEmail, subject, text, wrapHtml(`Aggiornamento Ticket #${userIndex}`, content));
}

async function sendNewCommentEmail(recipientEmail, ticketId, authorName, isToOperatore = false) {
  const displayId = isToOperatore ? ticketId : ticketRepo.getUserTicketIndex(ticketId);
  const subject = isToOperatore
    ? `Nuovo messaggio per il ticket #${displayId}`
    : `Risposta al tuo ticket #${displayId}`;
    
  const body = isToOperatore
    ? `L'utente ha aggiunto un nuovo messaggio al ticket #${displayId}. Accedi alla dashboard per rispondere.`
    : `<strong>${authorName}</strong> ha appena inserito una risposta al tuo ticket #${displayId}.`;
    
  const content = `<p>${body}</p>
                   <p>Accedi alla piattaforma DeskFlow per leggere il messaggio completo e continuare la conversazione in maniera rapida e sicura.</p>`;
                   
  const headerTitle = isToOperatore ? `Aggiornamento Ticket #${displayId}` : `Nuova risposta al Ticket #${displayId}`;
  await send(recipientEmail, subject, body, wrapHtml(headerTitle, content));
}

module.exports = {
  sendWelcomeEmail,
  sendTicketCreatedEmail,
  sendTicketAssignedEmail,
  sendStatusChangedEmail,
  sendNewCommentEmail,
};
