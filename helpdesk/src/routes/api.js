'use strict';

// API JSON per polling client-side
// Endpoint utilizzato dai client per ottenere aggiornamenti in tempo reale sullo stato del ticket.
// -----------------------------------------------------------------------------
const express     = require('express');
const ticketsRepo = require('../repositories/tickets.repo');

const router = express.Router();

// Restituisce lo stato attuale e la data di aggiornamento di un ticket specifico.
// Controlla che l'utente loggato sia il reale proprietario del ticket prima di inviare i dati.
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
