'use strict';
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../../data/helpdesk.db'));
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE VIEW IF NOT EXISTS v_tickets AS 
  SELECT *, ROW_NUMBER() OVER(ORDER BY created_at ASC, id ASC) AS display_id 
  FROM tickets;
`);

module.exports = db;
