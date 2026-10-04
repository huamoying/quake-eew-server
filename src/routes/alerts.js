/**
 * 最近地震列表（App“近7天地震”页可改走这里，由服务端统一拉取台网速报）。
 *   GET /api/alerts?limit=30
 */
const express = require('express');

module.exports = function alertsRouter(agg) {
  const router = express.Router();
  router.get('/', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 30;
    res.json({ ok: true, count: agg.recent.length, list: agg.getRecent(limit) });
  });
  return router;
};
