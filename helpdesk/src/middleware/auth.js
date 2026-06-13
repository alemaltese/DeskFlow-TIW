'use strict';

function requireUtente(req, res, next) {
  if (!res.locals.currentUser) {
    return res.status(403).render('errors/403', { title: 'Accesso Negato' });
  }
  next();
}

function requireOperatore(req, res, next) {
  if (!res.locals.currentUser) {
    return res.status(403).render('errors/403', { title: 'Accesso Negato' });
  }
  if (res.locals.currentUser.role !== 'operatore' && res.locals.currentUser.role !== 'admin') {
    return res.status(403).render('errors/403', { title: 'Accesso Negato' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!res.locals.currentUser) {
    return res.status(403).render('errors/403', { title: 'Accesso Negato' });
  }
  if (res.locals.currentUser.role !== 'admin') {
    return res.status(403).render('errors/403', { title: 'Accesso Negato' });
  }
  next();
}

module.exports = { requireUtente, requireOperatore, requireAdmin };
