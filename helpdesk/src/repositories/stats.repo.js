'use strict';
const db = require('../db/connection');

const countTotalTicketsStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM tickets`);

const avgFirstResponseStmt = db.prepare(`
  SELECT AVG((julianday(fc.first_comment) - julianday(t.created_at)) * 24) AS hrs
  FROM tickets t
  JOIN (
    SELECT c.ticket_id, MIN(c.created_at) AS first_comment
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE u.role IN ('operatore', 'admin')
    GROUP BY c.ticket_id
  ) fc ON fc.ticket_id = t.id
`);

const avgResolutionStmt = db.prepare(`
  SELECT AVG((julianday(h.changed_at) - julianday(t.created_at)) * 24) AS hrs
  FROM tickets t
  JOIN status_history h ON h.ticket_id = t.id AND h.new_value = 'risolto'
  WHERE t.status IN ('risolto', 'chiuso')
`);

const avgRatingStmt = db.prepare(`SELECT AVG(r.score) AS avg FROM ratings r`);

const byCategoryStmt = db.prepare(`
  SELECT category, COUNT(*) AS count FROM tickets GROUP BY category ORDER BY count DESC
`);

const byStatusStmt = db.prepare(`
  SELECT status, COUNT(*) AS count FROM tickets GROUP BY status ORDER BY count DESC
`);

const byPriorityStmt = db.prepare(`
  SELECT priority, COUNT(*) AS count FROM tickets
  GROUP BY priority
  ORDER BY CASE priority WHEN 'urgente' THEN 4 WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC
`);

const workloadStmt = db.prepare(`
  SELECT
    u.name,
    COUNT(t.id) as totale,
    SUM(CASE WHEN t.status IN ('aperto','in_corso') THEN 1 ELSE 0 END) as attivi,
    SUM(CASE WHEN t.status = 'risolto' THEN 1 ELSE 0 END) as risolti,
    SUM(CASE WHEN t.status = 'chiuso' THEN 1 ELSE 0 END) as chiusi
  FROM users u
  LEFT JOIN tickets t ON t.assigned_to = u.id
  WHERE u.role = 'operatore'
  GROUP BY u.id, u.name
  ORDER BY attivi DESC
`);

const operatorPerfStmt = db.prepare(`
  SELECT u.name,
         COUNT(DISTINCT t.id) AS ticket_assegnati,
         SUM(CASE WHEN t.status IN ('risolto', 'chiuso') THEN 1 ELSE 0 END) AS ticket_risolti,
         ROUND(AVG(r.score), 1) AS rating_medio
  FROM users u
  LEFT JOIN tickets t ON t.assigned_to = u.id
  LEFT JOIN ratings r ON r.ticket_id = t.id
  WHERE u.role = 'operatore'
  GROUP BY u.id
  ORDER BY ticket_risolti DESC
`);

const tassoCategoriaStmt = db.prepare(`
  SELECT
    category,
    COUNT(*) as totale,
    SUM(CASE WHEN status IN ('risolto','chiuso') THEN 1 ELSE 0 END) as risolti,
    SUM(CASE WHEN status IN ('aperto','in_corso') THEN 1 ELSE 0 END) as aperti
  FROM tickets
  GROUP BY category
  ORDER BY totale DESC
`);

function countTotalTickets()   { return countTotalTicketsStmt.get().cnt; }
function getAvgFirstResponse() { return avgFirstResponseStmt.get().hrs; }
function getAvgResolution()    { return avgResolutionStmt.get().hrs; }
function getAvgRating()        { return avgRatingStmt.get().avg; }
function getByCategory()       { return byCategoryStmt.all(); }
function getByStatus()         { return byStatusStmt.all(); }
function getByPriority()       { return byPriorityStmt.all(); }
function getWorkload()         { return workloadStmt.all(); }
function getOperatorPerf()     { return operatorPerfStmt.all() || []; }
function getTassoCategoria()   { return tassoCategoriaStmt.all(); }

// NOTE: dynamic query — prepared at call time because WHERE clause varies per request
function buildTrend(filterSql, params) {
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    last7.push({
      dateStr: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }),
    });
  }
  const sevenDaysAgo = last7[0].dateStr;
  const rawFilter = filterSql ? `AND ${filterSql}` : '';
  const trendRaw = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS count
    FROM tickets
    WHERE created_at >= ? ${rawFilter}
    GROUP BY day
  `).all(sevenDaysAgo, ...params);

  const trendMap = {};
  trendRaw.forEach(r => { trendMap[r.day] = r.count; });

  const trend = last7.map(d => ({ date: d.label, count: trendMap[d.dateStr] || 0 }));
  const maxCount = Math.max(...trend.map(d => d.count), 1);
  trend.forEach(d => { d.heightPerc = Math.round((d.count / maxCount) * 100); });
  return trend;
}

module.exports = {
  countTotalTickets,
  getAvgFirstResponse,
  getAvgResolution,
  getAvgRating,
  getByCategory,
  getByStatus,
  getByPriority,
  getWorkload,
  getOperatorPerf,
  getTassoCategoria,
  buildTrend,
};
