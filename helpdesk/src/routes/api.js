'use strict';

/**
 * Questo modulo espone le API in formato JSON pensate appositamente per il polling client-side.
 * L'obiettivo è fornire agli endpoint utilizzati dal frontend (o dalle app client) un modo veloce
 * e leggero per ottenere aggiornamenti in tempo reale, ad esempio per rinfrescare lo stato di un ticket.
 */

const express     = require('express');
const ticketsRepo = require('../repositories/tickets.repo');

const router = express.Router();

/**
 * Endpoint per ottenere lo stato aggiornato di un singolo ticket.
 * Prima di inviare qualsiasi informazione, la funzione effettua una serie di controlli di sicurezza:
 * si assicura che l'ID sia valido, che l'utente sia regolarmente loggato e, cosa ancora più importante,
 * che l'utente richiedente sia effettivamente il proprietario del ticket in questione per tutelare la privacy.
 */
router.get('/api/tickets/:id/status', function (req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid_id' });

  if (!req.session.userId) return res.status(401).json({ error: 'unauthenticated' });

  const ticket = ticketsRepo.findById(id);
  if (!ticket) return res.status(404).json({ error: 'not_found' });

  if (ticket.user_id !== req.session.userId) return res.status(403).json({ error: 'forbidden' });

  res.json({ ticketId: ticket.id, status: ticket.status, updatedAt: ticket.updated_at });
});

module.exports = router;
