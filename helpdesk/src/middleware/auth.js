'use strict';

function requireUtente(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function requireOperatore(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'operatore' && req.session.user.role !== 'admin') {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Non hai i permessi per questa pagina.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('error', { title: 'Accesso negato', message: 'Non hai i permessi per questa pagina.' });
  }
  next();
}

module.exports = { requireUtente, requireOperatore, requireAdmin };
