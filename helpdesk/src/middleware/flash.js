'use strict';
module.exports = function flashMiddleware(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.setFlash = (type, message) => { req.session.flash = { type, message }; };
  next();
};
