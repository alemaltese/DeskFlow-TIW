'use strict';
const db = require('../db/connection');

const PRIORITY_ORDER = `CASE t.priority
  WHEN 'urgente' THEN 4
  WHEN 'alta'    THEN 3
  WHEN 'media'   THEN 2
  ELSE 1 END`;

const VALID_STATUS   = ['aperto', 'in_corso', 'risolto', 'chiuso'];
const VALID_PRIORITY = ['bassa', 'media', 'alta', 'urgente'];
const VALID_CATEGORY = ['tecnico', 'account', 'fatturazione', 'altro'];

// ── Simple reads ─────────────────────────────────────────────────────────────
const findByIdStmt = db.prepare(`SELECT * FROM tickets WHERE id = ?`);

const findByUserIdStmt = db.prepare(`
  SELECT * FROM tickets
  WHERE user_id = ?
  ORDER BY created_at DESC
`);

const findDetailByIdStmt = db.prepare(`
  SELECT t.*, u.name AS user_name, op.name AS operator_name
  FROM tickets t
  JOIN users u ON t.user_id = u.id
  LEFT JOIN users op ON t.assigned_to = op.id
  WHERE t.id = ?
`);

const findAdminDetailByIdStmt = db.prepare(`
  SELECT t.*, u.name AS user_name, u.email AS user_email, op.name AS operator_name
  FROM tickets t
  JOIN users u ON u.id = t.user_id
  LEFT JOIN users op ON op.id = t.assigned_to
  WHERE t.id = ?
`);

// ── Comment & history reads ──────────────────────────────────────────────────
const getPublicCommentsStmt = db.prepare(`
  SELECT c.*, u.name AS author_name, u.role AS author_role
  FROM comments c
  JOIN users u ON c.user_id = u.id
  WHERE c.ticket_id = ? AND c.is_internal = 0
  ORDER BY c.created_at ASC
`);

const getAllCommentsStmt = db.prepare(`
  SELECT c.*, u.name AS author_name, u.role AS author_role
  FROM comments c
  JOIN users u ON c.user_id = u.id
  WHERE c.ticket_id = ?
  ORDER BY c.created_at ASC
`);

const getHistoryStmt = db.prepare(`
  SELECT sh.*, u.name AS changed_by_name
  FROM status_history sh
  JOIN users u ON sh.changed_by = u.id
  WHERE sh.ticket_id = ?
  ORDER BY sh.changed_at ASC
`);

const getRatingStmt = db.prepare(`SELECT * FROM ratings WHERE ticket_id = ?`);

// ── Operator dashboard reads ─────────────────────────────────────────────────
const getStatusCountsByOperatorStmt = db.prepare(`
  SELECT status, COUNT(*) AS n
  FROM tickets
  WHERE assigned_to = ?
  GROUP BY status
`);

const getActiveTicketsByOperatorStmt = db.prepare(`
  SELECT t.*, u.name AS user_name
  FROM tickets t
  JOIN users u ON t.user_id = u.id
  WHERE t.assigned_to = ? AND t.status IN ('aperto', 'in_corso')
  ORDER BY ${PRIORITY_ORDER} DESC, t.created_at ASC
`);

const getResolvedThisMonthStmt = db.prepare(`
  SELECT COUNT(*) AS n FROM tickets
  WHERE assigned_to = ?
    AND status IN ('risolto', 'chiuso')
    AND strftime('%Y-%m', updated_at) = strftime('%Y-%m', 'now')
`);

const getAvgRatingByOperatorStmt = db.prepare(`
  SELECT ROUND(AVG(r.score), 1) AS avg
  FROM ratings r
  JOIN tickets t ON r.ticket_id = t.id
  WHERE t.assigned_to = ?
`);

// ── Admin dashboard reads ────────────────────────────────────────────────────
const getTicketCountsAdminStmt = db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN status = 'aperto'   THEN 1 ELSE 0 END) AS aperto,
    SUM(CASE WHEN status = 'in_corso' THEN 1 ELSE 0 END) AS in_corso,
    SUM(CASE WHEN status = 'risolto'  THEN 1 ELSE 0 END) AS risolto,
    SUM(CASE WHEN status = 'chiuso'   THEN 1 ELSE 0 END) AS chiuso
  FROM tickets
`);

const getUnassignedTicketsStmt = db.prepare(`
  SELECT t.id, t.title, t.category, t.priority, t.status, t.created_at,
         u.name AS user_name
  FROM tickets t
  JOIN users u ON u.id = t.user_id
  WHERE t.assigned_to IS NULL AND t.status NOT IN ('risolto', 'chiuso')
  ORDER BY ${PRIORITY_ORDER} DESC, t.created_at ASC
  LIMIT 10
`);

const getOperatorWorkloadStmt = db.prepare(`
  SELECT u.id, u.name,
         COUNT(t.id) AS active_tickets
  FROM users u
  LEFT JOIN tickets t ON t.assigned_to = u.id AND t.status NOT IN ('risolto', 'chiuso')
  WHERE u.role = 'operatore'
  GROUP BY u.id
  ORDER BY active_tickets DESC
`);

const getRecentTicketsStmt = db.prepare(`
  SELECT t.id, t.title, t.category, t.priority, t.status, t.created_at,
         u.name AS user_name, op.name AS operator_name
  FROM tickets t
  JOIN users u ON u.id = t.user_id
  LEFT JOIN users op ON op.id = t.assigned_to
  ORDER BY t.created_at DESC
  LIMIT 5
`);

// ── Write statements ─────────────────────────────────────────────────────────
const insertTicketStmt = db.prepare(`
  INSERT INTO tickets (user_id, title, description, category, priority, status, assigned_to)
  VALUES (?, ?, ?, ?, ?, 'aperto', ?)
`);

const insertHistoryStmt = db.prepare(`
  INSERT INTO status_history (ticket_id, changed_by, event_type, old_value, new_value)
  VALUES (?, ?, ?, ?, ?)
`);

const insertHistoryWithTsStmt = db.prepare(`
  INSERT INTO status_history (ticket_id, changed_by, event_type, old_value, new_value, changed_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertCommentStmt = db.prepare(`
  INSERT INTO comments (ticket_id, user_id, content, is_internal)
  VALUES (?, ?, ?, ?)
`);

const insertRatingStmt = db.prepare(`
  INSERT INTO ratings (ticket_id, user_id, score, note)
  VALUES (?, ?, ?, ?)
`);

const updateStatusWithTsStmt  = db.prepare(`UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?`);
const updateStatusCurTsStmt   = db.prepare(`UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
const updateAssignedToStmt    = db.prepare(`UPDATE tickets SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
const updatePriorityWithTsStmt = db.prepare(`UPDATE tickets SET priority = ?, updated_at = ? WHERE id = ?`);
const updatePriorityCurTsStmt  = db.prepare(`UPDATE tickets SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);

// ── Transactions ─────────────────────────────────────────────────────────────
const createTicketTx = db.transaction((userId, title, description, category, priority, assignedTo) => {
  const result = insertTicketStmt.run(userId, title, description, category, priority, assignedTo);
  insertHistoryStmt.run(result.lastInsertRowid, userId, 'status', '', 'aperto');
  return result.lastInsertRowid;
});

const closeTicketTx = db.transaction((ticketId, userId, now, score, note) => {
  updateStatusWithTsStmt.run('chiuso', now, ticketId);
  insertHistoryWithTsStmt.run(ticketId, userId, 'status', 'risolto', 'chiuso', now);
  if (score >= 1 && score <= 5) {
    insertRatingStmt.run(ticketId, userId, score, note);
  }
});

const reopenTicketTx = db.transaction((ticketId, userId, now) => {
  updateStatusWithTsStmt.run('aperto', now, ticketId);
  insertHistoryWithTsStmt.run(ticketId, userId, 'status', 'chiuso', 'aperto', now);
});

const updateTicketStatusTx = db.transaction((ticketId, userId, oldStatus, newStatus, now) => {
  updateStatusWithTsStmt.run(newStatus, now, ticketId);
  insertHistoryWithTsStmt.run(ticketId, userId, 'status', oldStatus, newStatus, now);
});

const updateTicketPriorityTx = db.transaction((ticketId, userId, oldPriority, newPriority, now) => {
  updatePriorityWithTsStmt.run(newPriority, now, ticketId);
  insertHistoryWithTsStmt.run(ticketId, userId, 'priority', oldPriority, newPriority, now);
});

const updateAdminStatusTx = db.transaction((ticketId, userId, oldStatus, newStatus) => {
  updateStatusCurTsStmt.run(newStatus, ticketId);
  insertHistoryStmt.run(ticketId, userId, 'status', oldStatus, newStatus);
});

const updateAdminPriorityTx = db.transaction((ticketId, userId, oldPriority, newPriority) => {
  updatePriorityCurTsStmt.run(newPriority, ticketId);
  insertHistoryStmt.run(ticketId, userId, 'priority', oldPriority, newPriority);
});

const assignTicketTx = db.transaction((ticketId, userId, newOpId, oldOpName, newOpName, currentStatus) => {
  updateAssignedToStmt.run(newOpId, ticketId);
  insertHistoryStmt.run(ticketId, userId, 'assign', oldOpName, newOpName);
  if (currentStatus === 'aperto' && newOpId) {
    updateStatusCurTsStmt.run('in_corso', ticketId);
    insertHistoryStmt.run(ticketId, userId, 'status', 'aperto', 'in_corso');
  }
});

// ── Read functions ───────────────────────────────────────────────────────────
function findById(id)                { return findByIdStmt.get(id); }
function findByUserId(userId)        { return findByUserIdStmt.all(userId); }
function findDetailById(id)          { return findDetailByIdStmt.get(id); }
function findAdminDetailById(id)     { return findAdminDetailByIdStmt.get(id); }
function getPublicComments(ticketId) { return getPublicCommentsStmt.all(ticketId); }
function getAllComments(ticketId)     { return getAllCommentsStmt.all(ticketId); }
function getHistory(ticketId)        { return getHistoryStmt.all(ticketId); }
function getRating(ticketId)         { return getRatingStmt.get(ticketId); }

function getStatusCountsByOperator(opId) { return getStatusCountsByOperatorStmt.all(opId); }
function getActiveTicketsByOperator(opId){ return getActiveTicketsByOperatorStmt.all(opId); }
function getResolvedThisMonth(opId)      { return getResolvedThisMonthStmt.get(opId).n; }
function getAvgRatingByOperator(opId)    { return getAvgRatingByOperatorStmt.get(opId).avg; }
function getTicketCountsAdmin()          { return getTicketCountsAdminStmt.get(); }
function getUnassignedTickets()          { return getUnassignedTicketsStmt.all(); }
function getOperatorWorkload()           { return getOperatorWorkloadStmt.all(); }
function getRecentTickets()              { return getRecentTicketsStmt.all(); }

// NOTE: dynamic query — prepared at call time because WHERE clause varies per request
function filterOperatorTickets(operatorId, { status, priority, category, search } = {}) {
  const conditions = ['t.assigned_to = ?'];
  const params     = [operatorId];

  if (status   && VALID_STATUS.includes(status))     { conditions.push('t.status = ?');   params.push(status); }
  if (priority && VALID_PRIORITY.includes(priority)) { conditions.push('t.priority = ?'); params.push(priority); }
  if (category && VALID_CATEGORY.includes(category)) { conditions.push('t.category = ?'); params.push(category); }
  if (search && search.trim()) {
    conditions.push('(t.title LIKE ? OR t.description LIKE ?)');
    const term = `%${search.trim()}%`;
    params.push(term, term);
  }

  return db.prepare(`
    SELECT t.*, u.name AS user_name
    FROM tickets t
    JOIN users u ON t.user_id = u.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${PRIORITY_ORDER} DESC, t.created_at DESC
  `).all(...params);
}

// NOTE: dynamic query — prepared at call time because WHERE clause varies per request
function filterAdminTickets({ status, priority, category, assigned_to, search } = {}) {
  const conditions = [];
  const params     = [];

  if (status)   { conditions.push('t.status = ?');   params.push(status); }
  if (priority) { conditions.push('t.priority = ?'); params.push(priority); }
  if (category) { conditions.push('t.category = ?'); params.push(category); }
  if (assigned_to === 'null') {
    conditions.push('t.assigned_to IS NULL');
  } else if (assigned_to) {
    conditions.push('t.assigned_to = ?');
    params.push(Number(assigned_to));
  }
  if (search && search.trim()) {
    conditions.push('t.title LIKE ?');
    params.push(`%${search.trim()}%`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  return db.prepare(`
    SELECT t.id, t.title, t.category, t.priority, t.status, t.created_at,
           u.name AS user_name, op.name AS operator_name
    FROM tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN users op ON op.id = t.assigned_to
    ${where}
    ORDER BY CASE t.priority WHEN 'urgente' THEN 4 WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC,
             t.created_at DESC
  `).all(...params);
}

// ── Write functions ──────────────────────────────────────────────────────────
function createTicket(userId, title, description, category, priority, assignedTo) {
  return createTicketTx(userId, title, description, category, priority, assignedTo);
}
function addComment(ticketId, userId, content, isInternal) {
  return insertCommentStmt.run(ticketId, userId, content, isInternal);
}
function closeTicket(ticketId, userId, now, score, note) {
  return closeTicketTx(ticketId, userId, now, score, note);
}
function reopenTicket(ticketId, userId, now) {
  return reopenTicketTx(ticketId, userId, now);
}
function updateTicketStatus(ticketId, userId, oldStatus, newStatus, now) {
  return updateTicketStatusTx(ticketId, userId, oldStatus, newStatus, now);
}
function updateTicketPriority(ticketId, userId, oldPriority, newPriority, now) {
  return updateTicketPriorityTx(ticketId, userId, oldPriority, newPriority, now);
}
function assignTicket(ticketId, userId, newOpId, oldOpName, newOpName, currentStatus) {
  return assignTicketTx(ticketId, userId, newOpId, oldOpName, newOpName, currentStatus);
}
function updateAdminStatus(ticketId, userId, oldStatus, newStatus) {
  return updateAdminStatusTx(ticketId, userId, oldStatus, newStatus);
}
function updateAdminPriority(ticketId, userId, oldPriority, newPriority) {
  return updateAdminPriorityTx(ticketId, userId, oldPriority, newPriority);
}

module.exports = {
  findById,
  findByUserId,
  findDetailById,
  findAdminDetailById,
  getPublicComments,
  getAllComments,
  getHistory,
  getRating,
  getStatusCountsByOperator,
  getActiveTicketsByOperator,
  getResolvedThisMonth,
  getAvgRatingByOperator,
  getTicketCountsAdmin,
  getUnassignedTickets,
  getOperatorWorkload,
  getRecentTickets,
  filterOperatorTickets,
  filterAdminTickets,
  createTicket,
  addComment,
  closeTicket,
  reopenTicket,
  updateTicketStatus,
  updateTicketPriority,
  assignTicket,
  updateAdminStatus,
  updateAdminPriority,
};
