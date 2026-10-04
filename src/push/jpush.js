/**
 * 极光推送 JPush（REST API v3）：App 被杀/没打开时，靠厂商离线通道把预警弹出来。
 * 文档：https://docs.jiguang.cn/jpush/server/push/rest_api_v3_push
 * 鉴权：HTTP Header Authorization: Basic base64(AppKey:MasterSecret)
 * 未配置 AppKey/Master Secret 时自动跳过（不影响其它功能）。
 */
const config = require('../config');
const { devices } = require('../store');

function configured() {
  return !!(config.jpushAppKey && config.jpushMasterSecret);
}

/**
 * 向所有已注册设备推送一条地震预警通知
 * @returns {Promise<{skipped?:boolean,reason?:string,status?:number,body?:string}>}
 */
async function pushAlert(e) {
  if (!configured()) {
    console.log('[jpush] 未配置 JPUSH_APPKEY/JPUSH_MASTER_SECRET，跳过离线推送');
    return { skipped: true, reason: 'not_configured' };
  }
  const regIds = Object.keys(devices.all());
  if (!regIds.length) {
    console.log('[jpush] 暂无注册设备，跳过离线推送');
    return { skipped: true, reason: 'no_devices' };
  }

  const mag = e.Magnitude;
  const place = e.HypoCenter || '未知区域';
  const depth = e.Depth;
  const title = '地震预警提醒';
  const alert = `监测到 ${mag} 级地震，震中${place}，震源深度约 ${depth} 千米，请立即就近避险！（转发台网公开信息）`;

  const body = {
    platform: 'android',
    audience: { registration_id: regIds },
    notification: {
      android: {
        alert,
        title,
        priority: 0, // 0=最高优先级
        builder_id: 0,
        extras: { type: 'fj_eew', payload: JSON.stringify(e) },
      },
    },
    options: {
      time_to_live: 300,          // 离线消息保留 300 秒（预警有时效性，过期无意义）
      apns_production: false,
    },
  };

  const auth = Buffer.from(`${config.jpushAppKey}:${config.jpushMasterSecret}`).toString('base64');
  const url = config.jpushApiBase.replace(/\/+$/, '') + '/v3/push';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: 'Basic ' + auth,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      console.warn('[jpush] 推送失败 HTTP', res.status, text.slice(0, 300));
    } else {
      console.log('[jpush] 已向', regIds.length, '台设备推送预警');
    }
    return { status: res.status, body: text.slice(0, 500) };
  } catch (err) {
    console.warn('[jpush] 请求异常:', err.message);
    return { status: 0, body: String(err.message) };
  }
}

/**
 * 向所有已注册设备推送一条自定义文本通知（命令台 notify / 极光页“测试推送”用）
 */
async function pushText(text, title) {
  if (!configured()) return { skipped: true, reason: 'not_configured' };
  const regIds = Object.keys(devices.all());
  if (!regIds.length) return { skipped: true, reason: 'no_devices' };
  const body = {
    platform: 'android',
    audience: { registration_id: regIds },
    notification: {
      android: {
        alert: text,
        title: title || '地震预警提醒',
        priority: 0,
        builder_id: 0,
        extras: { type: 'notice' },
      },
    },
    options: { time_to_live: 300, apns_production: false },
  };
  const auth = Buffer.from(`${config.jpushAppKey}:${config.jpushMasterSecret}`).toString('base64');
  const url = config.jpushApiBase.replace(/\/+$/, '') + '/v3/push';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Basic ' + auth },
      body: JSON.stringify(body),
    });
    const text2 = await res.text();
    if (!res.ok) console.warn('[jpush] 文本推送失败 HTTP', res.status, text2.slice(0, 300));
    else console.log('[jpush] 已向', regIds.length, '台设备推送文本通知');
    return { status: res.status, body: text2.slice(0, 500) };
  } catch (err) {
    console.warn('[jpush] 文本推送异常:', err.message);
    return { status: 0, body: String(err.message) };
  }
}

module.exports = { pushAlert, pushText, configured };
