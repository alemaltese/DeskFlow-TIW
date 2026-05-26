'use strict';
const db = require('../db/db');

function getOperatorWithFewestTickets() {
  const result = db.prepare(`
    SELECT u.id
    FROM users u
    LEFT JOIN tickets t
      ON t.assigned_to = u.id
      AND t.status NOT IN ('risolto', 'chiuso')
    WHERE u.role = 'operatore'
    GROUP BY u.id
    ORDER BY COUNT(t.id) ASC, RANDOM()
    LIMIT 1
  `).get();
  return result ? result.id : null;
}

module.exports = { getOperatorWithFewestTickets };
