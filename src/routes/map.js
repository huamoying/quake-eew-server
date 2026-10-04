/**
 * 腾讯位置服务代理：Key 只放在服务器环境变量里，App 不再携带 Key，防止被盗刷。
 * App 把原本直连 apis.map.qq.com 的三类请求改到这里，返回体与腾讯原样一致。
 *   GET /api/map/geocode?lat=&lng=          逆地址解析（坐标→地址）
 *   GET /api/map/poi?lat=&lng=&keyword=     周边 POI 搜索（应急避难场所）
 *   GET /api/map/ip?ip=                     IP 城市级定位（室内 GPS 弱时兜底）
 */
const express = require('express');
const config = require('../config');

const router = express.Router();
const BASE = 'https://apis.map.qq.com/ws';

async function tencent(apiPath, query) {
  const q = new URLSearchParams(query);
  q.set('key', config.tencentMapKey);
  const url = `${BASE}${apiPath}?${q.toString()}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const json = await res.json();
    return { http: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

function noKey(res) {
  return res.status(503).json({ status: 503, message: '服务端未配置 TENCENT_MAP_KEY' });
}

// 逆地址解析
router.get('/geocode', async (req, res) => {
  if (!config.tencentMapKey) return noKey(res);
  const { lat, lng } = req.query;
  if (!(lat && lng)) return res.status(400).json({ status: 400, message: '缺少 lat/lng' });
  try {
    const r = await tencent('/geocoder/v1/', { location: `${lat},${lng}`, get_poi: '0' });
    res.status(r.http).json(r.json);
  } catch (e) {
    res.status(502).json({ status: 502, message: '上游请求失败: ' + e.message });
  }
});

// 周边 POI 搜索（避难场所等）
router.get('/poi', async (req, res) => {
  if (!config.tencentMapKey) return noKey(res);
  const { lat, lng, keyword = '应急避难场所', radius = '2000' } = req.query;
  if (!(lat && lng)) return res.status(400).json({ status: 400, message: '缺少 lat/lng' });
  try {
    const r = await tencent('/place/v1/search', {
      keyword: String(keyword),
      boundary: `nearby(${lat},${lng},${radius})`,
      orderby: '_distance',
      page_size: '20',
      page_index: '1',
      output: 'json',
    });
    res.status(r.http).json(r.json);
  } catch (e) {
    res.status(502).json({ status: 502, message: '上游请求失败: ' + e.message });
  }
});

// IP 城市级定位（不传 ip 时由腾讯按请求来源解析；服务器侧调用建议 App 传其公网 IP，或直接用网络定位）
router.get('/ip', async (req, res) => {
  if (!config.tencentMapKey) return noKey(res);
  try {
    const query = {};
    if (req.query.ip) query.ip = String(req.query.ip);
    const r = await tencent('/location/v1/ip', query);
    res.status(r.http).json(r.json);
  } catch (e) {
    res.status(502).json({ status: 502, message: '上游请求失败: ' + e.message });
  }
});

module.exports = router;
