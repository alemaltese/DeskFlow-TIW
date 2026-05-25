'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'helpdesk.db'));
db.pragma('foreign_keys = ON');

const createTables = db.transaction(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL,
      name            TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'utente',
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      title       TEXT NOT NULL,
      description TEXT NOT NULL,
      category    TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'aperto',
      priority    TEXT NOT NULL DEFAULT 'media',
      assigned_to INTEGER REFERENCES users(id),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS comments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id   INTEGER NOT NULL REFERENCES tickets(id),
      user_id     INTEGER NOT NULL REFERENCES users(id),
      content     TEXT NOT NULL,
      is_internal INTEGER NOT NULL DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS status_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id   INTEGER NOT NULL REFERENCES tickets(id),
      changed_by  INTEGER NOT NULL REFERENCES users(id),
      old_status  TEXT NOT NULL,
      new_status  TEXT NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id   INTEGER NOT NULL UNIQUE REFERENCES tickets(id),
      user_id     INTEGER NOT NULL REFERENCES users(id),
      score       INTEGER NOT NULL,
      note        TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

createTables();
console.log('Database inizializzato');
db.close();
