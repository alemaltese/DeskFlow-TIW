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

  // 5. Workload operatori
  const workload = db.prepare(`
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
  `).all();

  const maxAttivi = Math.max(...workload.map(w => w.attivi || 0), 1);
  workload.forEach(w => {
    w.attiviPerc  = Math.round(((w.attivi  || 0) / maxAttivi) * 100) || 4;
    w.risoltiPerc = Math.round(((w.risolti || 0) / maxAttivi) * 100) || 4;
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

  // 7. Tasso di risoluzione per categoria
  const tassoCategoria = db.prepare(`
    SELECT
      category,
      COUNT(*) as totale,
      SUM(CASE WHEN status IN ('risolto','chiuso') THEN 1 ELSE 0 END) as risolti,
      SUM(CASE WHEN status IN ('aperto','in_corso') THEN 1 ELSE 0 END) as aperti
    FROM tickets
    GROUP BY category
    ORDER BY totale DESC
  `).all();

  tassoCategoria.forEach(c => {
    c.tassoPerc = c.totale > 0 ? Math.round((c.risolti / c.totale) * 100) : 0;
    c.colore = c.tassoPerc >= 75 ? '#22c55e' : c.tassoPerc >= 40 ? '#f59e0b' : '#ef4444';
  });

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
    workload: workload || [],
    operatorPerf: operatorPerf || [],
    tassoCategoria: tassoCategoria || [],
  });
});

module.exports = router;
