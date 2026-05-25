'use strict';
const express = require('express');
const db = require('../db/db');
const { requireAdmin, requireOperatore } = require('../middleware/auth');

const router = express.Router();

function isoNow(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString().replace('T', ' ').slice(0, 19);
}

function computeDistribution(rows, total) {
  return rows.map(r => ({
    ...r,
    percentage: total > 0 ? Math.round((r.count / total) * 100) : 0,
  }));
}

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

// ── Admin analytics ─────────────────────────────────────────────────────────
router.get('/admin/stats', requireAdmin, (req, res) => {
  const overdueSince = isoNow(-48 * 60 * 60 * 1000);

  // 1. KPI – tutti i ticket senza filtro temporale
  const totalTickets = db.prepare(`SELECT COUNT(*) AS cnt FROM tickets`).get().cnt;

  const avgFirstResponse = db.prepare(`
    SELECT AVG((julianday(fc.first_comment) - julianday(t.created_at)) * 24) AS hrs
    FROM tickets t
    JOIN (
      SELECT c.ticket_id, MIN(c.created_at) AS first_comment
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE u.role IN ('operatore', 'admin')
      GROUP BY c.ticket_id
    ) fc ON fc.ticket_id = t.id
  `).get().hrs;

  const avgResolution = db.prepare(`
    SELECT AVG((julianday(h.changed_at) - julianday(t.created_at)) * 24) AS hrs
    FROM tickets t
    JOIN status_history h ON h.ticket_id = t.id AND h.new_value = 'risolto'
    WHERE t.status IN ('risolto', 'chiuso')
  `).get().hrs;

  const avgRating = db.prepare(`SELECT AVG(r.score) AS avg FROM ratings r`).get().avg;

  // 2-4. Distribuzioni senza filtro temporale
  const byCategoryRaw = db.prepare(
    `SELECT category, COUNT(*) AS count FROM tickets GROUP BY category ORDER BY count DESC`
  ).all();
  const byCategory = computeDistribution(byCategoryRaw, totalTickets);

  const byStatusRaw = db.prepare(
    `SELECT status, COUNT(*) AS count FROM tickets GROUP BY status ORDER BY count DESC`
  ).all();
  const byStatus = computeDistribution(byStatusRaw, totalTickets);

  const byPriorityRaw = db.prepare(
    `SELECT priority, COUNT(*) AS count FROM tickets
     GROUP BY priority
     ORDER BY CASE priority WHEN 'urgente' THEN 4 WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC`
  ).all();
  const byPriority = computeDistribution(byPriorityRaw, totalTickets);

  // 5. Trend: ultimi 7 giorni con ticket presenti nel DB
  const trendRaw = db.prepare(`
    SELECT DATE(created_at) as day, COUNT(*) as count
    FROM tickets
    GROUP BY DATE(created_at)
    ORDER BY day DESC
    LIMIT 7
  `).all().reverse();

  const maxCount = Math.max(...trendRaw.map(d => d.count), 1);
  const trend = trendRaw.map(item => {
    const d = new Date(item.day + 'T00:00:00');
    return {
      date: d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }),
      count: item.count,
      heightPerc: Math.round((item.count / maxCount) * 100) || 4,
    };
  });

  // 6. Performance operatori senza filtro temporale
  const operatorPerf = db.prepare(`
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
  `).all() || [];

  operatorPerf.forEach(op => {
    op.starsArr = op.rating_medio
      ? [1,2,3,4,5].map(n => n <= Math.round(op.rating_medio))
      : null;
  });

  // 7. Ticket scaduti
  const overdueCount = db.prepare(
    `SELECT COUNT(*) AS cnt FROM tickets WHERE status IN ('aperto', 'in_corso') AND created_at < ?`
  ).get(overdueSince).cnt;

  const overdueList = db.prepare(`
    SELECT t.id, t.title, t.priority, t.status, t.created_at, u.name AS user_name
    FROM tickets t JOIN users u ON u.id = t.user_id
    WHERE t.status IN ('aperto', 'in_corso') AND t.created_at < ?
    ORDER BY t.created_at ASC
    LIMIT 5
  `).all(overdueSince);

  const avgRatingVal = avgRating ? Math.round(avgRating) : null;
  const avgRatingStars = avgRatingVal ? [1,2,3,4,5].map(n => n <= avgRatingVal) : null;

  res.render('admin/stats', {
    title: 'Dashboard Analytics',
    kpi: {
      totalTickets,
      avgFirstResponse: avgFirstResponse != null ? avgFirstResponse.toFixed(1) : null,
      avgResolution:    avgResolution    != null ? avgResolution.toFixed(1)    : null,
      avgRating:        avgRating        != null ? avgRating.toFixed(1)        : null,
      avgRatingStars,
    },
    byCategory: byCategory || [],
    byStatus: byStatus || [],
    byPriority: byPriority || [],
    trend: trend || [],
    operatorPerf: operatorPerf || [],
    overdueCount,
    overdueList: overdueList || [],
  });
});

// ── Operator analytics ───────────────────────────────────────────────────────
router.get('/operatore/stats', requireOperatore, (req, res) => {
  const opId = req.session.user.id;
  const since = isoNow(-30 * 24 * 60 * 60 * 1000);

  const totalAssigned = db.prepare(
    `SELECT COUNT(*) AS cnt FROM tickets WHERE assigned_to = ? AND created_at >= ?`
  ).get(opId, since).cnt;

  const totalRisolti = db.prepare(
    `SELECT COUNT(*) AS cnt FROM tickets WHERE assigned_to = ? AND status IN ('risolto', 'chiuso') AND created_at >= ?`
  ).get(opId, since).cnt;

  const avgRating = db.prepare(`
    SELECT ROUND(AVG(r.score), 1) AS avg
    FROM ratings r
    JOIN tickets t ON t.id = r.ticket_id
    WHERE t.assigned_to = ? AND t.created_at >= ?
  `).get(opId, since).avg;

  const avgRatingVal = avgRating ? Math.round(avgRating) : null;
  const avgRatingStars = avgRatingVal ? [1,2,3,4,5].map(n => n <= avgRatingVal) : null;

  const byStatusRaw = db.prepare(
    `SELECT status, COUNT(*) AS count FROM tickets WHERE assigned_to = ? AND created_at >= ? GROUP BY status ORDER BY count DESC`
  ).all(opId, since);
  const byStatus = computeDistribution(byStatusRaw, totalAssigned);

  const byPriorityRaw = db.prepare(
    `SELECT priority, COUNT(*) AS count FROM tickets WHERE assigned_to = ? AND created_at >= ?
     GROUP BY priority
     ORDER BY CASE priority WHEN 'urgente' THEN 4 WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC`
  ).all(opId, since);
  const byPriority = computeDistribution(byPriorityRaw, totalAssigned);

  const trend = buildTrend('assigned_to = ?', [opId]);

  res.render('operatore/stats', {
    title: 'Le mie statistiche',
    kpi: {
      totalAssigned,
      totalRisolti,
      avgRating: avgRating != null ? avgRating.toFixed(1) : null,
      avgRatingStars,
    },
    byStatus, byPriority, trend,
  });
});

module.exports = router;
