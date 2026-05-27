
'use strict';
const db = require('../db/connection');

const findByEmailStmt              = db.prepare(`SELECT * FROM users WHERE email = ?`);
const findIdByEmailStmt            = db.prepare(`SELECT id FROM users WHERE email = ?`);
const findIdByEmailExcludingStmt   = db.prepare(`SELECT id FROM users WHERE email = ? AND id != ?`);
const findByIdStmt                 = db.prepare(`SELECT * FROM users WHERE id = ?`);
const findByIdNotAdminStmt         = db.prepare(`SELECT * FROM users WHERE id = ? AND role != 'admin'`);
const findPasswordHashByIdStmt     = db.prepare(`SELECT password_hash FROM users WHERE id = ?`);
const findNameByIdStmt             = db.prepare(`SELECT name FROM users WHERE id = ?`);
const listOperatorsStmt            = db.prepare(`SELECT id, name FROM users WHERE role = 'operatore' ORDER BY name`);
const listUsersWithTicketCountStmt = db.prepare(`
  SELECT u.id, u.name, u.email, u.role, u.created_at, COUNT(t.id) AS ticket_count
  FROM users u
  LEFT JOIN tickets t ON t.user_id = u.id
  WHERE u.role != 'admin'
  GROUP BY u.id
  ORDER BY u.role, u.name
`);
const getUserCountsStmt = db.prepare(`
  SELECT
    SUM(CASE WHEN role = 'utente'    THEN 1 ELSE 0 END) AS utenti,
    SUM(CASE WHEN role = 'operatore' THEN 1 ELSE 0 END) AS operatori
  FROM users
  WHERE role != 'admin'
`);
const getOperatorFewestTicketsStmt = db.prepare(`
  SELECT u.id
  FROM users u
  LEFT JOIN tickets t
    ON t.assigned_to = u.id
    AND t.status NOT IN ('risolto', 'chiuso')
  WHERE u.role = 'operatore'
  GROUP BY u.id
  ORDER BY COUNT(t.id) ASC, RANDOM()
  LIMIT 1
`);
const insertUserStmt              = db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`);
const updateNameEmailStmt         = db.prepare(`UPDATE users SET name = ?, email = ? WHERE id = ?`);
const updateNameEmailPasswordStmt = db.prepare(`UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?`);
const updateUserFullStmt          = db.prepare(`UPDATE users SET name = ?, email = ?, password_hash = ?, role = ? WHERE id = ?`);

function findByEmail(email)                        { return findByEmailStmt.get(email); }
function findIdByEmail(email)                      { return findIdByEmailStmt.get(email); }
function findIdByEmailExcluding(email, excludeId)  { return findIdByEmailExcludingStmt.get(email, excludeId); }
function findById(id)                              { return findByIdStmt.get(id); }
function findByIdNotAdmin(id)                      { return findByIdNotAdminStmt.get(id); }
function findPasswordHashById(id)                  { return findPasswordHashByIdStmt.get(id); }
function findNameById(id)                          { return findNameByIdStmt.get(id); }
function listOperators()                           { return listOperatorsStmt.all(); }
function listUsersWithTicketCount()                { return listUsersWithTicketCountStmt.all(); }
function getUserCounts()                           { return getUserCountsStmt.get(); }

function getOperatorWithFewestTickets() {
  const result = getOperatorFewestTicketsStmt.get();
  return result ? result.id : null;
}

function createUser(name, email, passwordHash, role) {
  return insertUserStmt.run(name, email, passwordHash, role);
}
function updateUserNameEmail(id, name, email) {
  return updateNameEmailStmt.run(name, email, id);
}
function updateUserNameEmailPassword(id, name, email, passwordHash) {
  return updateNameEmailPasswordStmt.run(name, email, passwordHash, id);
}
function updateUserFull(id, name, email, passwordHash, role) {
  return updateUserFullStmt.run(name, email, passwordHash, role, id);
}

module.exports = {
  findByEmail,
  findIdByEmail,
  findIdByEmailExcluding,
  findById,
  findByIdNotAdmin,
  findPasswordHashById,
  findNameById,
  listOperators,
  listUsersWithTicketCount,
  getUserCounts,
  getOperatorWithFewestTickets,
  createUser,
  updateUserNameEmail,
  updateUserNameEmailPassword,
  updateUserFull,
};
