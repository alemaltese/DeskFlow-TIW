'use strict';

function requireUtente(req, res, next) {
  if (!res.locals.currentUser) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function requireOperatore(req, res, next) {
  if (!res.locals.currentUser) return res.redirect('/login');
  if (res.locals.currentUser.role !== 'operatore' && res.locals.currentUser.role !== 'admin') {
    req.setFlash('error', 'Non hai i permessi per questa pagina.');
    return res.redirect('/');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!res.locals.currentUser) return res.redirect('/login');
  if (res.locals.currentUser.role !== 'admin') {
    req.setFlash('error', 'Non hai i permessi per questa pagina.');
    return res.redirect('/');
  }
  next();
}

module.exports = { requireUtente, requireOperatore, requireAdmin };
