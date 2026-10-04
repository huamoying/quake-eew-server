/**
 * 数据源一：Wolfx 实时 EEW WebSocket（秒级）。
 * 后端作为客户端长连，断线指数退避自动重连；收到 type=fj_eew 即交给聚合器。
 * 报文结构与 App 直连时完全相同，后端只做透传，App 无需改解析。
 */
const WebSocket = require('ws');
const config = require('../config');

function connectOne(url, agg, status) {
  let backoff = 5;
  let ws = null;
  let stopped = false;

  const open = () => {
    if (stopped) return;
    let wsRef;
    try {
      wsRef = new WebSocket(url);
    } catch (e) {
      scheduleReopen('创建连接失败');
      return;
    }
    ws = wsRef;

    wsRef.on('open', () => {
      backoff = 5;
      status.wolfx[url] = true;
      console.log('[wolfx] 已连接:', url);
    });

    wsRef.on('message', (data) => {
      try {
        const d = JSON.parse(data.toString());
        if (d && d.type === 'fj_eew') {
          d._source = 'wolfx';
          const r = agg.ingest(d, 'wolfx');
          if (r === 'alert') console.log('[wolfx] 活跃预警:', d.ReportTime, d.Magnitude, d.HypoCenter);
        }
        // 其它 type（心跳/hello/测试）忽略
      } catch (e) {
        /* 非 JSON 心跳，忽略 */
      }
    });

    const scheduleReopen = (why) => {
      status.wolfx[url] = false;
      try { wsRef.terminate(); } catch (e) {}
      if (stopped) return;
      console.log(`[wolfx] ${why}，${backoff}s 后重连:`, url);
      setTimeout(open, backoff * 1000);
      backoff = Math.min(60, backoff * 2);
    };

    wsRef.on('close', () => scheduleReopen('连接关闭'));
    wsRef.on('error', () => scheduleReopen('连接异常'));
  };

  open();
  return { stop() { stopped = true; try { ws && ws.terminate(); } catch (e) {} } };
}

function start(agg, status) {
  if (!config.enableWolfx) {
    console.log('[wolfx] 已通过 ENABLE_WOLFX=0 关闭');
    return [];
  }
  config.wolfxUrls.forEach((url) => { status.wolfx[url] = false; });
  return config.wolfxUrls.map((url) => connectOne(url, agg, status));
}

/* ===== 命令台动态开关支持 ===== */
let handlers = [];

/** 启动全部连接，记录句柄（供 stop/setEnabled 使用） */
function startTracked(agg, status) {
  handlers.forEach((h) => { try { h.stop(); } catch (e) {} });
  handlers = start(agg, status);
  return handlers.length;
}

/** 停止全部 wolfx 连接 */
function stopAll() {
  handlers.forEach((h) => { try { h.stop(); } catch (e) {} });
  handlers = [];
}

/** 命令台开关：on 启动 / off 停止（不重启进程） */
function setEnabled(agg, status, enabled) {
  config.enableWolfx = !!enabled;
  if (enabled) return startTracked(agg, status);
  stopAll();
  return 0;
}

module.exports = { start, startTracked, stopAll, setEnabled };
