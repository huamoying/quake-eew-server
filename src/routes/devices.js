/**
 * 设备注册：App 集成极光 SDK 后，启动时把极光 registrationId 上报到这里，
 * 后端据此向已安装设备推送。App 每次启动都上报一次（幂等），可在服务器存储丢失后自愈。
 *   POST   /api/devices            { registrationId, platform?, model?, alias? }
 *   POST   /api/devices/heartbeat  同上（心跳/刷新 lastSeen）
 *   DELETE /api/devices/:regId
 *   GET    /api/devices            调试用，返回数量
 */
const express = require('express');
const { devices } = require('../store');

const router = express.Router();

function upsert(req, res) {
  const body = req.body || {};
  const regId = String(body.registrationId || '').trim();
  if (!regId) return res.status(400).json({ ok: false, message: '缺少 registrationId' });
  const now = Date.now();
  const old = devices.get(regId) || {};
  devices.set(regId, {
    registrationId: regId,
    platform: body.platform || old.platform || 'android',
    model: body.model || old.model || '',
    alias: body.alias || old.alias || '',
    addedAt: old.addedAt || now,
    lastSeen: now,
  });
  res.json({ ok: true, count: Object.keys(devices.all()).length });
}

router.post('/', upsert);
router.post('/heartbeat', upsert);
router.delete('/:regId', (req, res) => {
  devices.del(req.params.regId);
  res.json({ ok: true });
});
router.get('/', (req, res) => {
  const all = devices.all();
  const list = Object.keys(all).map((k) => all[k]).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  res.json({ ok: true, count: list.length, list });
});

module.exports = router;
