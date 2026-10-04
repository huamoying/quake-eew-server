/**
 * 命令处理核心（网页命令台与终端 CLI 共用）：
 * 把一行命令解析成多行文本输出，不直接打 console ——
 * 网页版通过 WebSocket 发送结果，终端版打印结果。
 */
const config = require('./config');
const { devices } = require('./store');
const jpush = require('./push/jpush');

let agg = null;

/** 命令上下文：由 index.js / web-cmd.js / cli.js 启动后注入 */
let ctx = { status: null, wss: null, wolfx: null, cenc: null, broadcast: null };

/** 统计计数器（本次进程内累计） */
const counter = { injected: 0, pushed: 0, broadcast: 0 };

/** 绑定上下文（index.js 启动后调用）：aggregator + {status,wss,wolfx,cenc,broadcast} */
function bind(aggregator, extra) {
  agg = aggregator;
  Object.assign(ctx, extra || {});
}

/** 北京时间 yyyy-MM-dd HH:mm:ss */
function nowShanghai() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
       + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** 常用城市内置坐标（腾讯 Key 配额用尽/网络异常时的兜底，保证模拟功能可用） */
const CITY_COORDS = {
  '北京': [39.9042, 116.4074], '上海': [31.2304, 121.4737], '广州': [23.1291, 113.2644],
  '深圳': [22.5431, 114.0579], '成都': [30.5728, 104.0668], '重庆': [29.5630, 106.5516],
  '西安': [34.3416, 108.9398], '武汉': [30.5928, 114.3055], '杭州': [30.2741, 120.1551],
  '南京': [32.0603, 118.7969], '天津': [39.3434, 117.3616], '苏州': [31.2989, 120.5853],
  '郑州': [34.7466, 113.6254], '长沙': [28.2282, 112.9388], '昆明': [25.0389, 102.7183],
  '贵阳': [26.6477, 106.6302], '南宁': [22.8170, 108.3665], '海口': [20.0442, 110.1999],
  '福州': [26.0745, 119.2965], '厦门': [24.4798, 118.0894], '南昌': [28.6820, 115.8579],
  '济南': [36.6512, 117.1201], '青岛': [36.0671, 120.3826], '太原': [37.8706, 112.5489],
  '石家庄': [38.0428, 114.5149], '沈阳': [41.8057, 123.4315], '大连': [38.9140, 121.6147],
  '长春': [43.8171, 125.3235], '哈尔滨': [45.8038, 126.5349], '兰州': [36.0611, 103.8343],
  '西宁': [36.6171, 101.7782], '银川': [38.4872, 106.2309], '乌鲁木齐': [43.8256, 87.6168],
  '拉萨': [29.6449, 91.1000], '呼和浩特': [40.8415, 111.7521], '泸州': [28.8717, 105.4414],
  '绵阳': [31.4675, 104.6796], '宜宾': [28.7518, 104.6470], '自贡': [29.3392, 104.7784],
  '德阳': [31.1268, 104.3980], '南充': [30.8373, 106.1107], '达州': [31.2095, 107.4680],
  '乐山': [29.5521, 103.7656], '攀枝花': [26.5823, 101.7186], '雅安': [30.0103, 103.0420],
  '遂宁': [30.5133, 105.5713], '广元': [32.4354, 105.8434], '内江': [29.5802, 105.0584],
  '眉山': [30.0529, 103.8337], '资阳': [30.1289, 104.6279], '广安': [30.4560, 106.6332],
  '巴中': [31.8671, 106.7463], '甘孜': [30.0504, 101.9622], '凉山': [27.8816, 102.2677],
};

/** 腾讯地理编码：地名 -> {lat,lng}（在线解析优先，自动补后缀重试；失败用内置坐标兜底） */
async function geocode(place) {
  const key = config.tencentMapKey;
  const candidates = [place];
  if (!/(市|县|区|州|盟|旗|镇)$/.test(place)) {
    ['市', '县', '区', '镇'].forEach((s) => candidates.push(place + s));
  }
  for (const addr of candidates) {
    if (!key) break;
    const url = `https://apis.map.qq.com/ws/geocoder/v1/?address=${encodeURIComponent(addr)}&output=json&key=${key}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      const json = await res.json();
      if (json.status === 0 && json.result && json.result.location) {
        const loc = json.result.location;
        return { lat: loc.lat, lng: loc.lng, title: place };
      }
    } catch (e) {}
  }
  // 内置城市坐标兜底（腾讯 Key 配额用尽/网络异常时仍可模拟）
  const key2 = place.replace(/[市县区镇]$/, '');
  const hit = CITY_COORDS[place] || CITY_COORDS[key2];
  if (hit) return { lat: hit[0], lng: hit[1], title: place, cached: true };
  return null;
}

/** 注入模拟预警（ingest 自动触发 alert -> 广播 + 极光推送） */
function fire(out, { mag, lat, lng, depth, place }) {
  const e = {
    type: 'fj_eew',
    ReportTime: nowShanghai(),
    Magnitude: Math.round(mag * 10) / 10,
    Latitude: lat,
    Longitude: lng,
    Depth: Math.round(depth) || 10,
    HypoCenter: place,
    MaxIntensity: Math.min(12, Math.max(0, Math.round((mag - 3.5) * 2))),
    _source: 'sim',
  };
  const r = agg.ingest(e, 'sim');
  counter.injected++;
  out.push(`已注入：${place}  M${e.Magnitude}  深度 ${e.Depth}km  (${lat}, ${lng})`);
  if (r === 'alert') out.push('✔ 判定为活跃预警：已 WS 广播给在线 App + 已触发极光离线推送');
  else if (r === 'recent') out.push('已入最近列表（未触发实时告警，请检查时间是否 5 分钟内）');
  else if (r === 'duplicate') out.push('与近期事件重复，已忽略');
  else out.push('参数不合法，未注入');
  return e;
}

async function cmdSim(out, args) {
  if (!args.length) {
    out.push('用法：sim <地名> <震级>   或   sim <震级> <纬度> <经度> [深度] [地名]');
    out.push('示例：sim 泸州 5.5    /   sim 6.2 31.23 121.47 10 上海');
    return;
  }
  // 形式1：地名(可含空格) + 震级
  if (isNaN(parseFloat(args[0]))) {
    const mag = parseFloat(args[args.length - 1]);
    const place = args.slice(0, args.length - 1).join(' ');
    if (!(mag > 0) || mag > 10) return out.push('震级无效（0~10，如 5.5）');
    out.push(`正在查询「${place}」坐标…`);
    const g = await geocode(place);
    if (!g) {
      out.push('未收录该地名的内置坐标。');
      out.push('请改用坐标形式：sim <震级> <纬度> <经度> [深度] [地名]');
      out.push('例如：sim 5.5 28.9 105.4 10 四川泸州');
      return;
    }
    if (g.cached) out.push(`（已用内置坐标 ${g.lat},${g.lng}）`);
    return fire(out, { mag, lat: g.lat, lng: g.lng, depth: 10, place: g.title });
  }
  // 形式2：震级 纬度 经度 [深度] [地名]
  const mag = parseFloat(args[0]);
  const lat = parseFloat(args[1]);
  const lng = parseFloat(args[2]);
  if (!(mag > 0) || !(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    return out.push('参数无效。用法：sim <震级> <纬度> <经度> [深度] [地名]');
  }
  const depth = args[3] !== undefined && !isNaN(parseFloat(args[3])) ? parseFloat(args[3]) : 10;
  const place = args.slice(4).join(' ') || '模拟震中';
  return fire(out, { mag, lat, lng, depth, place });
}

function cmdRecent(out, n) {
  const lim = n && n > 0 ? Math.min(n, 30) : 10;
  const list = agg.getRecent(lim);
  if (!list.length) return out.push('最近暂无事件');
  out.push('最近事件（新→旧，共 ' + list.length + ' 条）：');
  list.forEach((e, i) => {
    out.push(`  ${i + 1}. ${e.ReportTime}  M${e.Magnitude}  ${e.HypoCenter}  (${e.Latitude}, ${e.Longitude})  来源:${e._source}`);
  });
}

function cmdStatus(out, status, wss) {
  out.push('服务运行时长：' + Math.round(process.uptime()) + ' 秒');
  const mem = process.memoryUsage();
  out.push('内存占用：' + (mem.rss / 1024 / 1024).toFixed(1) + ' MB');
  out.push('在线 WS 客户端：' + (wss ? wss.clients.size : 0) + ' 台');
  out.push('已注册设备（极光）：' + Object.keys(devices.all()).length + ' 台');
  out.push('数据源：Wolfx=' + (config.enableWolfx ? '开' : '关')
    + '  CENC轮询=' + (config.enableCencPoll ? '开' : '关')
    + '  极光推送=' + (jpush.configured() ? '已配置' : '未配置'));
  const c = status.cenc || {};
  if (c.lastOk) {
    const t = new Date(c.lastOk).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    out.push('台网最新拉取：' + t + '（' + c.count + ' 条）' + (c.error ? '  最近错误：' + c.error : ''));
  } else {
    out.push('台网尚未成功拉取' + (c.error ? '（错误：' + c.error + '）' : ''));
  }
}

/** devices：查看已注册到极光的设备 */
function cmdDevices(out) {
  const all = devices.all();
  const keys = Object.keys(all);
  if (!keys.length) {
    out.push('暂无注册设备。请先安装 APK 并打开 App，或在设置页点“手动注册极光推送”。');
    return;
  }
  out.push('已注册设备（共 ' + keys.length + ' 台）：');
  keys.forEach((d) => {
    const it = all[d] || {};
    const seen = it.lastSeen ? new Date(it.lastSeen).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '--';
    out.push(`  · ${it.model || '未知机型'}  (${it.platform || 'android'})`);
    out.push(`    regId: ${d}`);
    out.push(`    最后活跃: ${seen}`);
  });
}

/** push：只触发一次极光离线推送（不广播），用于验证手机离线通知 */
async function cmdPush(out, args) {
  if (!args.length) {
    out.push('用法：push <地名> <震级>   或   push <震级> <纬度> <经度> [深度] [地名]');
    return;
  }
  let mag, lat, lng, depth = 10, place;
  if (isNaN(parseFloat(args[0]))) {
    mag = parseFloat(args[args.length - 1]);
    place = args.slice(0, args.length - 1).join(' ');
    if (!(mag > 0)) return out.push('震级无效');
    out.push(`正在查询「${place}」坐标…`);
    const g = await geocode(place);
    if (!g) return out.push('未收录该地名坐标，请改用坐标形式');
    lat = g.lat; lng = g.lng; place = g.title;
  } else {
    mag = parseFloat(args[0]);
    lat = parseFloat(args[1]);
    lng = parseFloat(args[2]);
    if (!(mag > 0) || !(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) return out.push('参数无效');
    if (args[3] !== undefined && !isNaN(parseFloat(args[3]))) depth = parseFloat(args[3]);
    place = args.slice(4).join(' ') || '模拟震中';
  }
  const e = {
    type: 'fj_eew',
    ReportTime: nowShanghai(),
    Magnitude: Math.round(mag * 10) / 10,
    Latitude: lat,
    Longitude: lng,
    Depth: Math.round(depth) || 10,
    HypoCenter: place,
    MaxIntensity: Math.min(12, Math.max(0, Math.round((mag - 3.5) * 2))),
    _source: 'sim',
  };
  if (!jpush.configured()) return out.push('极光未配置（.env 缺 JPUSH_APPKEY/JPUSH_MASTER_SECRET），无法推送');
  const keys = Object.keys(devices.all());
  if (!keys.length) return out.push('暂无注册设备，请先在手机打开 App 完成极光注册');
  out.push(`正在推送：M${e.Magnitude} ${place}（${lat}, ${lng}）→ 极光 ${keys.length} 台设备…`);
  const r = await jpush.pushAlert(e);
  if (r && r.status === 200) { counter.pushed++; out.push('✔ 极光推送成功（HTTP 200）'); }
  else out.push('极光推送返回：' + (r && r.status ? 'HTTP ' + r.status + ' ' + (r.body || '') : (r && r.reason || '未知错误')));
}

/** notify：向所有设备推送一条自定义文本通知 */
async function cmdNotify(out, args) {
  const text = args.join(' ').trim();
  if (!text) return out.push('用法：notify <文本>');
  if (!jpush.configured()) return out.push('极光未配置，无法推送');
  const keys = Object.keys(devices.all());
  if (!keys.length) return out.push('暂无注册设备');
  out.push(`向 ${keys.length} 台设备推送文本通知：${text}`);
  const r = await jpush.pushText(text, '地震预警提醒');
  if (r && r.status === 200) out.push('✔ 推送成功（HTTP 200）');
  else out.push('推送返回：' + (r && r.status ? 'HTTP ' + r.status + ' ' + (r.body || '') : (r && r.reason || '未知错误')));
}

/** broadcast：向所有在线 App 广播一条消息 */
function cmdBroadcast(out, args, ws) {
  const text = args.join(' ').trim();
  if (!text) return out.push('用法：broadcast <文本>');
  if (!ctx.broadcast) return out.push('广播通道不可用');
  ctx.broadcast({ type: 'notice', text, time: nowShanghai() });
  counter.broadcast++;
  out.push('已广播给在线 App：' + text + '（在线 ' + (ws ? ws.clients.size : 0) + ' 台）');
}

/** locate：查询地名坐标 */
async function cmdLocate(out, args) {
  const place = args.join(' ').trim();
  if (!place) return out.push('用法：locate <地名>，如：locate 四川长宁');
  out.push(`正在查询「${place}」坐标…`);
  const g = await geocode(place);
  if (!g) return out.push('未收录该地名坐标');
  out.push(`「${g.title}」坐标：${g.lat}, ${g.lng}` + (g.cached ? '（内置坐标）' : '（腾讯在线解析）'));
}

/** wolfx on|off：动态开关 Wolfx 实时源 */
function cmdWolfx(out, args, status) {
  const v = (args[0] || '').toLowerCase();
  if (v !== 'on' && v !== 'off') return out.push('用法：wolfx on|off');
  if (!ctx.wolfx) return out.push('Wolfx 模块未注入');
  const n = ctx.wolfx.setEnabled(agg, status, v === 'on');
  out.push(v === 'on' ? `Wolfx 已开启（连接 ${n} 路）` : 'Wolfx 已关闭');
}

/** cenc on|off：动态开关台网速报轮询 */
function cmdCenc(out, args, status) {
  const v = (args[0] || '').toLowerCase();
  if (v !== 'on' && v !== 'off') return out.push('用法：cenc on|off');
  if (!ctx.cenc) return out.push('CENC 模块未注入');
  ctx.cenc.setEnabled(agg, status, v === 'on');
  out.push(v === 'on' ? '台网速报轮询已开启' : '台网速报轮询已关闭');
}

/** sources：查看数据源实时状态 */
function cmdSources(out, status) {
  const st = status || {};
  const w = st.wolfx || {};
  const keys = Object.keys(w);
  if (!keys.length) out.push('Wolfx：未配置连接');
  keys.forEach((k) => out.push('Wolfx ' + k + '：' + (w[k] ? '已连接' : '断开/重连中')));
  const c = st.cenc || {};
  if (c.lastOk) {
    out.push('台网速报：上次拉取 ' + new Date(c.lastOk).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      + '（' + c.count + ' 条）' + (c.error ? '，最近错误：' + c.error : ''));
  } else {
    out.push('台网速报：尚未拉取' + (c.error ? '（错误：' + c.error + '）' : ''));
  }
}

/** config：查看服务配置 */
function cmdConfig(out) {
  out.push('端口：' + config.port);
  out.push('极光推送：' + (jpush.configured() ? '已配置 (AppKey=' + config.jpushAppKey + ')' : '未配置'));
  out.push('腾讯地图Key：' + (config.tencentMapKey ? '已配置' : '未配置'));
  out.push('Wolfx 实时源：' + (config.enableWolfx ? '开' : '关') + '  URL=' + config.wolfxUrls.join(','));
  out.push('台网速报轮询：' + (config.enableCencPoll ? '开' : '关') + '  间隔=' + config.cencPollMs + 'ms');
  out.push('最近事件上限：' + config.maxRecentAlerts + '  去重窗口：' + config.dedupMs + 'ms');
}

/** uptime：运行时长与内存 */
function cmdUptime(out) {
  const s = Math.round(process.uptime());
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  out.push('运行时长：' + h + ' 小时 ' + m + ' 分 ' + sec + ' 秒');
  const mem = process.memoryUsage();
  out.push('内存：RSS ' + (mem.rss / 1024 / 1024).toFixed(1) + ' MB / 堆 ' + (mem.heapUsed / 1024 / 1024).toFixed(1) + ' MB');
}

/** clearalerts：清空最近事件列表 */
function cmdClearAlerts(out) {
  if (!agg) return out.push('聚合器未初始化');
  agg.clearRecent();
  out.push('已清空最近事件列表');
}

function cmdStatus(out, status, wss) {
  out.push('服务运行时长：' + Math.round(process.uptime()) + ' 秒');
  out.push('在线 WS 客户端：' + (wss ? wss.clients.size : 0) + ' 台');
  out.push('已注册设备（极光）：' + Object.keys(devices.all()).length + ' 台');
  out.push('数据源：Wolfx=' + (config.enableWolfx ? '开' : '关')
    + '  CENC轮询=' + (config.enableCencPoll ? '开' : '关')
    + '  极光推送=' + (jpush.configured() ? '已配置' : '未配置'));
  const c = status.cenc || {};
  if (c.lastOk) {
    const t = new Date(c.lastOk).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    out.push('台网最新拉取：' + t + '（' + c.count + ' 条）' + (c.error ? '  最近错误：' + c.error : ''));
  } else {
    out.push('台网尚未成功拉取' + (c.error ? '（错误：' + c.error + '）' : ''));
  }
}

/** stats：查看本次进程累计统计 */
function cmdStats(out, ws) {
  out.push('累计注入模拟预警（sim）：' + counter.injected + ' 条');
  out.push('累计极光离线推送（push）：' + counter.pushed + ' 次');
  out.push('累计广播（broadcast）：' + counter.broadcast + ' 次');
  out.push('在线 WS 客户端：' + (ws ? ws.clients.size : 0) + ' 台');
  out.push('已注册设备（极光）：' + Object.keys(devices.all()).length + ' 台');
  out.push('最近事件列表：' + (agg ? agg.getRecent(100).length : 0) + ' 条');
}

/** reboot：动态重启数据源连接（Wolfx + 台网轮询，无需重启进程） */
function cmdReboot(out) {
  if (!ctx.wolfx || !ctx.cenc) return out.push('数据源模块未注入，无法重启');
  const wolfxOn = config.enableWolfx;
  const cencOn = config.enableCencPoll;
  ctx.wolfx.setEnabled(agg, ctx.status, wolfxOn);
  ctx.cenc.setEnabled(agg, ctx.status, cencOn);
  out.push('已重启数据源：Wolfx=' + (wolfxOn ? '开' : '关')
    + '  台网轮询=' + (cencOn ? '开' : '关'));
}

/** env：查看当前环境配置摘要 */
function cmdEnv(out) {
  out.push('当前环境配置：');
  out.push('端口：' + config.port);
  out.push('Wolfx 实时源：' + (config.enableWolfx ? '开' : '关') + ' → ' + config.wolfxUrls.join(' , '));
  out.push('台网速报轮询：' + (config.enableCencPoll ? '开' : '关') + '，间隔 ' + config.cencPollMs + 'ms');
  out.push('台网速报 URL：' + config.cencListUrl);
  out.push('极光推送：' + (jpush.configured() ? '已配置' : '未配置'));
  out.push('腾讯地图 Key：' + (config.tencentMapKey ? '已配置' : '未配置'));
  out.push('命令台登录：' + (config.cmdUser && config.cmdPassword ? '已启用' : '未配置（命令台不可用）'));
  out.push('访问口令 AUTH_TOKEN：' + (config.authToken ? '已设置' : '未设置'));
}

function cmdHelp(out, cmd) {
  const H = {
    help: 'help [命令]    显示帮助，或查看某个命令的详细用法',
    sim: 'sim <地名> <震级>          按地名模拟地震（自动查坐标，地名可带空格）\n       sim <震级> <纬度> <经度> [深度] [地名]   按坐标模拟',
    recent: 'recent [N]    查看最近 N 条事件（默认 10 条）',
    status: 'status    查看服务状态（运行时长/在线设备/数据源）',
    devices: 'devices    查看已注册到极光的设备列表（registrationId/机型/时间）',
    push: 'push <地名> <震级>   或   push <震级> <纬度> <经度>\n       只触发一次极光离线推送（不广播给在线 App），用于验证手机离线通知',
    notify: 'notify <文本>    向所有已注册设备推送一条自定义文本通知（测试用）',
    broadcast: 'broadcast <文本>    向所有在线 App 广播一条消息',
    locate: 'locate <地名>    查询地名坐标（不注入地震）',
    wolfx: 'wolfx on|off    开/关 Wolfx 实时数据源（动态生效，无需重启）',
    cenc: 'cenc on|off    开/关台网速报轮询（动态生效，无需重启）',
    sources: 'sources    查看数据源实时状态（Wolfx 连接/台网拉取）',
    config: 'config    查看服务配置（端口/极光/地图/源开关）',
    time: 'time    显示服务器北京时间',
    uptime: 'uptime    显示运行时长与内存占用',
    version: 'version    显示版本信息',
    clearalerts: 'clearalerts    清空最近事件列表',
    echo: 'echo <文本>    原样回显（测试命令台连通）',
    ping: 'ping    连通测试，返回 pong 与时间',
    clear: 'clear    清空屏幕',
    cls: 'cls    清空屏幕（同 clear）',
    exit: 'exit    断开命令台连接',
    quit: 'quit    退出命令台（同 exit）',
    stats: 'stats    查看统计（累计注入/极光推送/广播次数）',
    reboot: 'reboot    重启数据源连接（Wolfx + 台网轮询，无需重启进程）',
    env: 'env    查看当前环境配置摘要',
  };
  if (cmd && H[cmd]) {
    out.push('命令 ' + cmd + '：');
    out.push(H[cmd].replace(/\n/g, '\n  '));
    return;
  }
  out.push('可用命令（共 ' + Object.keys(H).length + ' 个，help <命令> 看详情）：');
  Object.keys(H).forEach((k) => out.push('  ' + H[k].split('\n')[0]));
  out.push('  示例：sim 泸州 5.5   /   sim 6.2 31.23 121.47 10 上海   /   push 四川长宁 5.6');
}

/** 处理一行命令，返回多行文本输出 */
async function handle(line, status, wss) {
  const raw = String(line || '').trim();
  if (!raw) return '';
  const parts = raw.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);
  const st = status || ctx.status;
  const ws = wss || ctx.wss;
  const out = [];
  try {
    switch (cmd) {
      case 'help': cmdHelp(out, (args[0] || '').toLowerCase()); break;
      case 'sim': await cmdSim(out, args); break;
      case 'recent': cmdRecent(out, parseInt(args[0], 10)); break;
      case 'status': cmdStatus(out, st, ws); break;
      case 'devices': cmdDevices(out); break;
      case 'push': await cmdPush(out, args); break;
      case 'notify': await cmdNotify(out, args); break;
      case 'broadcast': cmdBroadcast(out, args, ws); break;
      case 'locate': await cmdLocate(out, args); break;
      case 'wolfx': cmdWolfx(out, args, st); break;
      case 'cenc': cmdCenc(out, args, st); break;
      case 'sources': cmdSources(out, st); break;
      case 'config': cmdConfig(out); break;
      case 'time': out.push('服务器时间（北京）：' + nowShanghai()); break;
      case 'uptime': cmdUptime(out); break;
      case 'version': out.push('quake-eew-server v1.2.0（命令台 26 条指令）'); break;
      case 'clearalerts': cmdClearAlerts(out); break;
      case 'echo': out.push(args.join(' ')); break;
      case 'ping': out.push('pong ' + nowShanghai()); break;
      case 'clear': break; // 由前端清屏
      case 'cls': break; // 由前端清屏
      case 'exit': out.push('bye'); break;
      case 'quit': out.push('bye'); break;
      case 'stats': cmdStats(out, ws); break;
      case 'reboot': cmdReboot(out); break;
      case 'env': cmdEnv(out); break;
      default: out.push('未知命令：' + cmd + '（输入 help 查看帮助）');
    }
  } catch (e) {
    out.push('命令执行异常：' + (e && e.message || e));
  }
  return out.join('\n');
}

module.exports = { bind, handle, nowShanghai };
