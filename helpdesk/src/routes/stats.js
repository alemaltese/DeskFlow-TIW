'use strict';
const express   = require('express');
const { requireAdmin } = require('../middleware/auth');
const statsRepo = require('../repositories/stats.repo');

const router = express.Router();

function computeDistribution(rows, total) {
  return rows.map(r => ({
    ...r,
    percentage: total > 0 ? Math.round((r.count / total) * 100) : 0,
  }));
}

// ── Admin analytics ───────────────────────────────────────────────────────────
router.get('/admin/stats', requireAdmin, (req, res) => {
  const totalTickets     = statsRepo.countTotalTickets();
  const avgFirstResponse = statsRepo.getAvgFirstResponse();
  const avgResolution    = statsRepo.getAvgResolution();
  const avgRating        = statsRepo.getAvgRating();

  const byCategory = computeDistribution(statsRepo.getByCategory(), totalTickets);
  const byStatus   = computeDistribution(statsRepo.getByStatus(),   totalTickets);
  const byPriority = computeDistribution(statsRepo.getByPriority(), totalTickets);

  const workload  = statsRepo.getWorkload();
  const maxAttivi = Math.max(...workload.map(w => w.attivi || 0), 1);
  workload.forEach(w => {
    w.attiviPerc  = Math.round(((w.attivi  || 0) / maxAttivi) * 100) || 4;
    w.risoltiPerc = Math.round(((w.risolti || 0) / maxAttivi) * 100) || 4;
  });

  const operatorPerf = statsRepo.getOperatorPerf();
  operatorPerf.forEach(op => {
    op.starsArr = op.rating_medio
      ? [1,2,3,4,5].map(n => n <= Math.round(op.rating_medio))
      : null;
  });

  const tassoCategoria = statsRepo.getTassoCategoria();
  tassoCategoria.forEach(c => {
    c.tassoPerc = c.totale > 0 ? Math.round((c.risolti / c.totale) * 100) : 0;
    c.colore = c.tassoPerc >= 75 ? '#22c55e' : c.tassoPerc >= 40 ? '#f59e0b' : '#ef4444';
  });

  const avgRatingVal   = avgRating ? Math.round(avgRating) : null;
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
    byStatus:   byStatus   || [],
    byPriority: byPriority || [],
    workload:        workload        || [],
    operatorPerf:    operatorPerf    || [],
    tassoCategoria:  tassoCategoria  || [],
  });
});

module.exports = router;
