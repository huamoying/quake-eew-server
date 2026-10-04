/**
 * 极光推送辅助接口（APP“极光”标签页用）：
 *   GET  /api/jpush/config    { configured, appKey, deviceCount }
 *   POST /api/jpush/test      向所有已注册设备推一条测试文本通知
 */
const express = require('express');
const jpush = require('../push/jpush');
const { devices } = require('../store');
const config = require('../config');

const router = express.Router();

router.get('/config', (req, res) => {
  res.json({
    ok: true,
    configured: jpush.configured(),
    appKey: jpush.configured() ? config.jpushAppKey : '',
    deviceCount: Object.keys(devices.all()).length,
  });
});

router.post('/test', async (req, res) => {
  if (!jpush.configured()) {
    return res.status(503).json({ ok: false, message: '极光未配置（.env 缺 JPUSH_APPKEY/JPUSH_MASTER_SECRET）' });
  }
  const keys = Object.keys(devices.all());
  if (!keys.length) {
    return res.status(404).json({ ok: false, message: '暂无注册设备，请先在手机打开 App 完成极光注册' });
  }
  const r = await jpush.pushText('这是地震预警 App 的极光推送测试，收到即代表离线推送通道正常。', '极光推送测试');
  if (r && r.status === 200) {
    return res.json({ ok: true, message: '已向 ' + keys.length + ' 台设备发送测试通知', result: r });
  }
  res.status(502).json({ ok: false, message: '极光推送失败', result: r });
});

module.exports = router;
