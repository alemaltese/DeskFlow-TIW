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

/**
 * ==========================================
 * QUERY DI LETTURA DI BASE
 * ==========================================
 * Questa sezione raccoglie le query fondamentali per il recupero delle informazioni
 * di base dei ticket, come la ricerca per ID, la lista dei ticket di un utente
 * o la visualizzazione dettagliata dei dati incrociati con le anagrafiche.
 */
const findByIdStmt = db.prepare(`SELECT * FROM tickets WHERE id = ?`);

const getUserTicketIndexStmt = db.prepare(`
  SELECT COUNT(*) AS idx
  FROM tickets
  WHERE user_id = (SELECT user_id FROM tickets WHERE id = ?)
    AND created_at <= (SELECT created_at FROM tickets WHERE id = ?)
`);

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

/**
 * ==========================================
 * QUERY PER COMMENTI E STORICO
 * ==========================================
 * Qui vengono definite le interrogazioni relative alle comunicazioni (commenti)
 * e alla tracciabilità degli eventi. Recuperano l'intera cronologia dei passaggi
 * di stato e le valutazioni finali rilasciate dai clienti.
 */
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

/**
 * ==========================================
 * QUERY PER LA DASHBOARD OPERATORE
 * ==========================================
 * Raggruppa gli statement necessari a calcolare gli indicatori di performance (KPI)
 * specifici per la vista dell'operatore: i ticket a lui assegnati suddivisi per stato,
 * quelli risolti nel corso del mese e la valutazione media del suo operato.
 */
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
  ORDER BY t.created_at DESC
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

/**
 * ==========================================
 * QUERY PER LA DASHBOARD AMMINISTRATORE
 * ==========================================
 * Serie di interrogazioni che forniscono panoramiche a livello globale sull'intero
 * sistema di helpdesk. Calcolano i totali assoluti, evidenziano eventuali ticket
 * rimasti in sospeso senza assegnazione e restituiscono i carichi di lavoro attuali.
 */
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
  ORDER BY t.created_at DESC
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

/**
 * ==========================================
 * STATEMENT DI SCRITTURA
 * ==========================================
 * Queste query si occupano dell'inserimento (INSERT), aggiornamento (UPDATE) e 
 * cancellazione (DELETE) dei record. Costituiscono i mattoni base utilizzati
 * successivamente dalle transazioni complesse per alterare lo stato del sistema.
 */
const insertTicketStmt = db.prepare(`
  INSERT INTO tickets (user_id, title, description, category, priority, status, assigned_to)
  VALUES (?, ?, ?, ?, ?, 'aperto', ?)
`);

const insertHistoryStmt = db.prepare(`
  INSERT INTO status_history (ticket_id, changed_by, event_type, old_value, new_value)
  VALUES (?, ?, ?, ?, ?)
`);


const insertCommentStmt = db.prepare(`
  INSERT INTO comments (ticket_id, user_id, content, is_internal)
  VALUES (?, ?, ?, ?)
`);

const insertRatingStmt = db.prepare(`
  INSERT INTO ratings (ticket_id, user_id, score, note)
  VALUES (?, ?, ?, ?)
`);

const deleteRatingStmt = db.prepare(`DELETE FROM ratings WHERE ticket_id = ?`);


const updateStatusCurTsStmt   = db.prepare(`UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
const updateAssignedToStmt    = db.prepare(`UPDATE tickets SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);

const updatePriorityCurTsStmt  = db.prepare(`UPDATE tickets SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);

/**
 * ==========================================
 * TRANSAZIONI DI SCRITTURA
 * ==========================================
 * Le transazioni raggruppano più operazioni di scrittura in un'unica unità atomica.
 * Questo garantisce l'integrità dei dati: ad esempio, se si cambia lo stato di un
 * ticket, viene contestualmente salvata la traccia nello storico senza rischio
 * di inconsistenze in caso di errore.
 */
const createTicketTx = db.transaction((userId, title, description, category, priority, assignedTo) => {
  const result = insertTicketStmt.run(userId, title, description, category, priority, assignedTo);
  insertHistoryStmt.run(result.lastInsertRowid, userId, 'status', '', 'aperto');
  return result.lastInsertRowid;
});

const closeTicketTx = db.transaction((ticketId, userId, score, note) => {
  updateStatusCurTsStmt.run('chiuso', ticketId);
  insertHistoryStmt.run(ticketId, userId, 'status', 'risolto', 'chiuso');
  if (score >= 1 && score <= 5) {
    insertRatingStmt.run(ticketId, userId, score, note);
  }
});

const reopenTicketTx = db.transaction((ticketId, userId) => {
  updateStatusCurTsStmt.run('aperto', ticketId);
  insertHistoryStmt.run(ticketId, userId, 'status', 'chiuso', 'aperto');
  deleteRatingStmt.run(ticketId);
});

const updateTicketStatusTx = db.transaction((ticketId, userId, oldStatus, newStatus) => {
  updateStatusCurTsStmt.run(newStatus, ticketId);
  insertHistoryStmt.run(ticketId, userId, 'status', oldStatus, newStatus);
});

const updateTicketPriorityTx = db.transaction((ticketId, userId, oldPriority, newPriority) => {
  updatePriorityCurTsStmt.run(newPriority, ticketId);
  insertHistoryStmt.run(ticketId, userId, 'priority', oldPriority, newPriority);
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

/**
 * ==========================================
 * WRAPPER FUNZIONI DI LETTURA
 * ==========================================
 * Queste funzioni fungono da interfaccia pubblica del modulo per i controller.
 * Espongono in modo pulito l'esecuzione dei vari statement preparati in precedenza.
 */
function findById(id)                { return findByIdStmt.get(id); }
function getUserTicketIndex(id)      { 
  const res = getUserTicketIndexStmt.get(id, id);
  return res ? res.idx : id;
}
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

// NOTA: Questa è una query dinamica. Viene costruita ed eseguita "on the fly"
// poiché la clausola WHERE dipende dai parametri di filtraggio richiesti dal client.
function filterOperatorTickets(operatorId, { status, priority, category, search, sort } = {}) {
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
    ORDER BY ${sort === 'tempo' ? 't.created_at DESC' : `${PRIORITY_ORDER} DESC, t.created_at DESC`}
  `).all(...params);
}

// NOTA: Come per l'operatore, questa è una query dinamica costruita a runtime
// per supportare i filtri avanzati della dashboard amministratore.
function filterAdminTickets({ status, priority, category, assigned_to, search, sort } = {}) {
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
    ORDER BY ${sort === 'tempo' ? 't.created_at DESC' : `${PRIORITY_ORDER} DESC, t.created_at DESC`}
  `).all(...params);
}

/**
 * ==========================================
 * WRAPPER FUNZIONI DI SCRITTURA
 * ==========================================
 * Interfaccia pubblica per richiamare le transazioni di modifica in modo semplice.
 * Isolano i controller dalla complessità dell'accesso ai dati sottostante.
 */
function createTicket(userId, title, description, category, priority, assignedTo) {
  return createTicketTx(userId, title, description, category, priority, assignedTo);
}
function addComment(ticketId, userId, content, isInternal) {
  return insertCommentStmt.run(ticketId, userId, content, isInternal);
}
function closeTicket(ticketId, userId, score, note) {
  return closeTicketTx(ticketId, userId, score, note);
}
function reopenTicket(ticketId, userId) {
  return reopenTicketTx(ticketId, userId);
}
function updateTicketStatus(ticketId, userId, oldStatus, newStatus) {
  return updateTicketStatusTx(ticketId, userId, oldStatus, newStatus);
}
function updateTicketPriority(ticketId, userId, oldPriority, newPriority) {
  return updateTicketPriorityTx(ticketId, userId, oldPriority, newPriority);
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
  getUserTicketIndex,
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
