'use strict';
const express       = require('express');
const bcrypt        = require('bcrypt');
const userRepo      = require('../repositories/users.repo');
const emailService  = require('../services/email.service');

const router = express.Router();

function homeFor(role) {
  if (role === 'admin')    return '/admin/dashboard';
  if (role === 'operatore') return '/operatore/dashboard';
  return '/tickets';
}

/**
 * Questa route si occupa di mostrare all'utente la schermata di login.
 * Come misura di usabilità, prima di renderizzare la pagina verifica se l'utente 
 * ha già una sessione attiva: in tal caso, anziché costringerlo a riautenticarsi,
 * lo reindirizza automaticamente alla dashboard appropriata in base al suo ruolo (admin, operatore o utente).
 */
router.get('/login', (req, res) => {
  if (res.locals.currentUser) return res.redirect(homeFor(res.locals.currentUser.role));
  res.render('auth/login', { title: 'Accedi' });
});

/**
 * Qui viene elaborato l'invio del modulo di login. La funzione estrae le credenziali 
 * fornite dall'utente, controlla che esistano nel database e verifica la validità 
 * della password confrontandola con l'hash salvato. Se tutto è corretto, crea una 
 * nuova sessione sicura e gestisce il redirect verso la pagina desiderata.
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('auth/login', { title: 'Accedi', error: 'Compila tutti i campi.', old: { email } });
  }

  const user = userRepo.findByEmail(email.trim().toLowerCase());
  if (!user) {
    return res.render('auth/login', { title: 'Accedi', error: 'Credenziali non valide.', old: { email } });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.render('auth/login', { title: 'Accedi', error: 'Credenziali non valide.', old: { email } });
  }

  req.session.userId = user.id;

  const returnTo = req.session.returnTo || null;
  delete req.session.returnTo;

  if (user.role === 'admin')     return res.redirect(returnTo || '/admin/dashboard');
  if (user.role === 'operatore') return res.redirect(returnTo || '/operatore/dashboard');
  res.redirect(returnTo || '/tickets');
});

/**
 * Questa route mostra il modulo per la registrazione di un nuovo utente.
 * Analogamente alla pagina di login, se un utente è già connesso viene subito 
 * reindirizzato alla propria area personale, evitando così che possa creare account 
 * duplicati per sbaglio mentre è ancora autenticato nel sistema.
 */
router.get('/register', (req, res) => {
  if (res.locals.currentUser) return res.redirect(homeFor(res.locals.currentUser.role));
  res.render('auth/register', { title: 'Registrati' });
});

/**
 * Questo endpoint riceve i dati del modulo di registrazione e si occupa di validare 
 * attentamente tutti i campi (presenza dei dati, robustezza della password, ecc.).
 * Se i controlli passano, genera un hash sicuro per la password, salva il nuovo utente 
 * nel database, effettua il login automatico e gli invia anche un'email di benvenuto.
 */
router.post('/register', async (req, res) => {
  const { name, email, password, confirm_password } = req.body;
  const errors = [];

  if (!name  || !name.trim())  errors.push('Il nome è obbligatorio.');
  if (!email || !email.trim()) errors.push("L'email è obbligatoria.");
  if (!password || password.length < 6) errors.push('La password deve essere di almeno 6 caratteri.');
  if (password !== confirm_password)    errors.push('Le password non coincidono.');

  if (errors.length) {
    return res.render('auth/register', { title: 'Registrati', errors, old: { name, email } });
  }

  const existing = userRepo.findIdByEmail(email.trim().toLowerCase());
  if (existing) {
    return res.render('auth/register', {
      title: 'Registrati',
      errors: ['Email già registrata.'],
      old: { name, email },
    });
  }

  const hash   = await bcrypt.hash(password, 10);
  const result = userRepo.createUser(name.trim(), email.trim().toLowerCase(), hash, 'utente');

  req.session.userId = result.lastInsertRowid;

  emailService.sendWelcomeEmail(email.trim().toLowerCase(), name.trim()).catch(() => {});

  req.setFlash('success', `Benvenuto, ${name.trim()}!`);
  res.redirect('/tickets');
});

/**
 * Quando richiamata, questa route distrugge completamente la sessione corrente 
 * dell'utente, rimuovendo qualsiasi traccia dei suoi dati in memoria, e lo riporta
 * in totale sicurezza alla schermata di login iniziale.
 */
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
