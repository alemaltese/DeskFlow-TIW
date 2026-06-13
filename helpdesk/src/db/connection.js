'use strict';
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../../data/helpdesk.db'));
db.pragma('foreign_keys = ON');

module.exports = db;
