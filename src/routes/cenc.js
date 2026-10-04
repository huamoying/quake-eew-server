/**
 * 台网速报列表代理：App“地震速报/近7天地图”页统一从自家后端取数，
 * 不再直连 api.wolfx.jp。返回体与上游 cenc_eqlist.json 原样一致
 * （{ "No1": {...}, "No2": {...} }），App 无需改解析逻辑。
 *   GET /api/cenc
 * 服务端短时缓存（8s，与轮询间隔一致），降低上游压力、加快 App 响应；
 * 上游失败但有缓存时降级返回缓存。
 */
const express = require('express');
const config = require('../config');

const router = express.Router();
const CACHE_MS = 8000;
let cacheAt = 0;
let cacheJson = null;
let inflight = null;

async function fetchUpstream() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(config.cencListUrl, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

router.get('/', async (req, res) => {
  const now = Date.now();
  if (cacheJson && now - cacheAt < CACHE_MS) {
    return res.json(cacheJson);
  }
  try {
    // 并发请求合并，避免缓存过期瞬间打爆上游
    if (!inflight) inflight = fetchUpstream();
    const json = await inflight;
    inflight = null;
    cacheAt = Date.now();
    cacheJson = json;
    res.json(json);
  } catch (e) {
    inflight = null;
    if (cacheJson) return res.json(cacheJson);
    res.status(502).json({ status: 502, message: '台网接口暂时不可用: ' + e.message });
  }
});

module.exports = router;
