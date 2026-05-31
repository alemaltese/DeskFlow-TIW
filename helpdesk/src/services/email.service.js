'use strict';

// ── Email service (Gmail SMTP) ─────────────────────────────────────────────
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const FROM = '"Helpdesk DeskFlow" <' + process.env.EMAIL_USER + '>';

async function send(to, subject, text, html) {
  try {
    await transporter.sendMail({ from: FROM, to, subject, text, html });
    console.log('[email] sent to', to, '|', subject);
  } catch (err) {
    console.error('[email] send error:', err.message);
  }
}

// ── sendWelcomeEmail ───────────────────────────────────────────────────────
async function sendWelcomeEmail(userEmail, userName, tempPassword = null) {
  const subject = 'Benvenuto su DeskFlow';
  const pwLine  = tempPassword ? `\nLa tua password temporanea: ${tempPassword}` : '';
  const text    = `Ciao ${userName},\n\nIl tuo account DeskFlow è stato creato con successo.${pwLine}\n\nBuon lavoro!`;
  const html    = `<p>Ciao <strong>${userName}</strong>,</p><p>Il tuo account DeskFlow è stato creato con successo.${tempPassword ? `<br>Password temporanea: <strong>${tempPassword}</strong>` : ''}</p>`;
  await send(userEmail, subject, text, html);
}

// ── sendTicketCreatedEmail ─────────────────────────────────────────────────
async function sendTicketCreatedEmail(userEmail, ticketId, title) {
  const subject = `Ticket #${ticketId} aperto`;
  const text    = `Il tuo ticket "#${ticketId} - ${title}" è stato aperto con successo. Ti aggiorneremo sullo stato.`;
  const html    = `<p>Il tuo ticket <strong>#${ticketId} — ${title}</strong> è stato aperto con successo.</p><p>Ti aggiorneremo non appena ci saranno novità.</p>`;
  await send(userEmail, subject, text, html);
}

// ── sendTicketAssignedEmail ────────────────────────────────────────────────
async function sendTicketAssignedEmail(recipientEmail, ticketId, title, isToUser = false) {
  const subject = isToUser
    ? `Il tuo ticket #${ticketId} è stato assegnato`
    : `Ticket #${ticketId} assegnato a te`;
  const body = isToUser
    ? `Il tuo ticket "${title}" è stato assegnato a un operatore. Riceverai presto assistenza.`
    : `Ti è stato assegnato il ticket #${ticketId}: "${title}". Accedi alla dashboard per gestirlo.`;
  await send(recipientEmail, subject, body, `<p>${body}</p>`);
}

// ── sendStatusChangedEmail ─────────────────────────────────────────────────
async function sendStatusChangedEmail(userEmail, ticketId, oldStatus, newStatus) {
  const subject  = `Ticket #${ticketId} — stato aggiornato`;
  const rateNote = newStatus === 'risolto' ? '\n\nPuoi lasciare una valutazione accedendo al tuo ticket.' : '';
  const text     = `Lo stato del ticket #${ticketId} è cambiato da "${oldStatus}" a "${newStatus}".${rateNote}`;
  const html     = `<p>Lo stato del ticket <strong>#${ticketId}</strong> è cambiato da <em>${oldStatus}</em> a <strong>${newStatus}</strong>.${newStatus === 'risolto' ? '<br>Puoi lasciare una valutazione accedendo al tuo ticket.' : ''}</p>`;
  await send(userEmail, subject, text, html);
}

// ── sendNewCommentEmail ────────────────────────────────────────────────────
async function sendNewCommentEmail(recipientEmail, ticketId, authorName, isToOperatore = false) {
  const subject = isToOperatore
    ? `Nuovo messaggio sul ticket #${ticketId}`
    : `Risposta al tuo ticket #${ticketId}`;
  const body = isToOperatore
    ? `L'utente ha aggiunto un nuovo messaggio al ticket #${ticketId}. Accedi alla dashboard per rispondere.`
    : `${authorName} ha risposto al tuo ticket #${ticketId}. Accedi a DeskFlow per leggere la risposta.`;
  await send(recipientEmail, subject, body, `<p>${body}</p>`);
}

module.exports = {
  sendWelcomeEmail,
  sendTicketCreatedEmail,
  sendTicketAssignedEmail,
  sendStatusChangedEmail,
  sendNewCommentEmail,
};
