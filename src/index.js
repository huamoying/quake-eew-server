/**
 * 地震预警后端入口：
 *  - HTTP REST：地图密钥代理 / 设备注册 / 应急资料云备份 / 最近地震 / 健康检查
 *  - WebSocket /ws：向在线 App 实时转发统一格式的 fj_eew 预警（与直连 wolfx 报文一致）
 *  - 数据源：Wolfx 实时 WS + CENC 速报轮询兜底，自动重连、去重
 *  - 离线推送：活跃预警同时调用极光 JPush，覆盖 App 被杀场景
 */
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const config = require('./config');
const { Aggregator } = require('./aggregate');
const wolfxWs = require('./sources/wolfxWs');
const cencPoll = require('./sources/cencPoll');
const jpush = require('./push/jpush');
const cli = require('./cli');
const webCmd = require('./web-cmd');
const { devices } = require('./store');

const mapRouter = require('./routes/map');
const devicesRouter = require('./routes/devices');
const profileRouter = require('./routes/profile');
const alertsRouterFactory = require('./routes/alerts');
const cencRouter = require('./routes/cenc');
const jpushRouter = require('./routes/jpush');

const app = express();
app.use(express.json({ limit: '256kb' }));

// 宽松 CORS：兼容 H5 预览/调试（APK 原生 WebView 不受影响）；带凭据的请求默认放行
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-auth-token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const aggregator = new Aggregator();

// 数据源运行状态（供 /health 排查）
const status = {
  startedAt: Date.now(),
  wolfx: {},
  cenc: { lastOk: 0, error: null, count: 0 },
};

// 可选访问口令：在环境变量设了 AUTH_TOKEN 才校验（Header: x-auth-token）；默认关闭
app.use('/api', (req, res, next) => {
  if (!config.authToken) return next();
  if (req.get('x-auth-token') === config.authToken) return next();
  res.status(401).json({ ok: false, message: '未授权：x-auth-token 不正确' });
});

// 根路径：网页命令台页面 / 纯文本说明（由 web-cmd.start 注册）

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'quake-eew-server',
    uptimeSec: Math.round(process.uptime()),
    wsClients: wss.clients.size,
    devices: Object.keys(devices.all()).length,
    jpushConfigured: jpush.configured(),
    sources: status,
    time: new Date().toISOString(),
  });
});

app.use('/api/map', mapRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/profile', profileRouter);
app.use('/api/alerts', alertsRouterFactory(aggregator));
app.use('/api/cenc', cencRouter);
app.use('/api/jpush', jpushRouter);

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// 统一 upgrade 路由：/ws 预警通道；/cmd-ws 命令台（web-cmd 注册的监听器处理，这里只放行）
server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try { pathname = new URL(req.url, 'http://x').pathname; } catch (e) { return; }
  if (pathname !== '/ws') return;
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function broadcast(obj) {
  const s = JSON.stringify(obj);
  wss.clients.forEach((ws) => {
    if (ws.readyState === 1) {
      try { ws.send(s); } catch (e) {}
    }
  });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});
  // 握手 + 最近事件快照（App 只处理 type=fj_eew，其它自动忽略）
  try {
    ws.send(JSON.stringify({ type: 'hello', server: 'quake-eew-server', time: new Date().toISOString() }));
    ws.send(JSON.stringify({ type: 'recent', list: aggregator.getRecent(10) }));
  } catch (e) {}
});

// 心跳：30s ping，清理死连接
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { try { ws.terminate(); } catch (e) {} return; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 30000);

// 活跃预警：广播给在线 App + 极光离线推送（推送失败不影响主流程）
aggregator.on('alert', (e) => {
  console.log('[alert] 活跃预警 -> 广播 + 极光推送:', e.ReportTime, e.Magnitude, e.HypoCenter, '(' + e._source + ')');
  broadcast(e);
  jpush.pushAlert(e).catch((err) => console.warn('[jpush] 异常:', err.message));
});

server.listen(config.port, '0.0.0.0', () => {
  console.log('==============================================');
  console.log(' quake-eew-server 已启动');
  console.log(' HTTP : http://0.0.0.0:' + config.port + '/health');
  console.log(' WS   : ws://0.0.0.0:' + config.port + '/ws');
  console.log(' 极光推送:', jpush.configured() ? '已配置' : '未配置(跳过)');
  console.log(' 腾讯地图Key:', config.tencentMapKey ? '已配置' : '未配置(地图代理不可用)');
  console.log(' 交互命令台: 已开启（输入 help / sim 泸州 5.5 模拟地震）');
  console.log('==============================================');
  wolfxWs.start(aggregator, status);
  cencPoll.start(aggregator, status);
  const cmdCtx = { wolfx: wolfxWs, cenc: cencPoll, broadcast };
  webCmd.start(app, server, aggregator, status, wss, cmdCtx);
  cli.start(aggregator, status, wss, cmdCtx);
});

module.exports = { app, server };
