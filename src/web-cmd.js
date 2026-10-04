/**
 * 网页版命令台（带账号密码登录）：
 *   GET  /                 浏览器访问公网地址 → CMD 风格终端页（先登录，验证通过才能用命令）
 *   GET  /api/cmd/config   {login:true/false} 页面据此显示登录框
 *   POST /api/cmd/login    {username,password} → {ok, token}（24 小时有效）
 *   WS   /cmd-ws?token=..  实时通道：上行命令、下行输出
 *
 * 安全：账号密码由 .env 的 CMD_USER / CMD_PASSWORD 配置；
 * 未配置账号密码时命令台不可用（防止公网地址被他人乱推送）。
 */
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const config = require('./config');
const commands = require('./commands');

// 登录会话：token -> 过期时间戳
const sessions = new Map();
const SESSION_MS = 24 * 3600 * 1000;

function loginRequired() {
  return !!(config.cmdUser && config.cmdPassword);
}

function newToken() {
  const tok = crypto.randomBytes(24).toString('hex');
  sessions.set(tok, Date.now() + SESSION_MS);
  return tok;
}

function validToken(tok) {
  if (!tok) return false;
  const exp = sessions.get(tok);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(tok);
    return false;
  }
  return true;
}

const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>地震预警后端 · 命令台</title>
<style>
  * { box-sizing:border-box; }
  body { margin:0; height:100vh; display:flex; flex-direction:column;
    background:#0a0e14; color:#c9d1d9; font:14px/1.6 Consolas,Menlo,"Courier New",monospace; }
  .titlebar { background:#161b22; color:#8b949e; padding:8px 16px; font-size:12px;
    border-bottom:1px solid #21262d; display:flex; justify-content:space-between; }
  #term { flex:1; overflow-y:auto; padding:14px 16px; }
  .line { white-space:pre-wrap; word-break:break-all; }
  .cmd { color:#7ee787; } .err { color:#ff7b72; } .warn { color:#d29922; }
  #inputrow { display:flex; align-items:center; border-top:1px solid #21262d; background:#0d1117; }
  #prompt { color:#7ee787; padding:10px 12px; user-select:none; }
  #inp { flex:1; background:transparent; border:none; outline:none; color:#c9d1d9;
    font:inherit; padding:10px 12px 10px 0; }
  #login { margin:auto; width:340px; padding:24px; background:#0d1117; border:1px solid #21262d;
    border-radius:8px; }
  #login h2 { margin:0 0 4px; font-size:16px; color:#e6edf3; }
  #login p { margin:0 0 16px; color:#8b949e; font-size:12px; }
  #login input { width:100%; margin-bottom:12px; padding:9px 10px; background:#161b22;
    border:1px solid #30363d; border-radius:6px; color:#c9d1d9; font:inherit; outline:none; }
  #login input:focus { border-color:#58a6ff; }
  #login button { width:100%; padding:9px; background:#238636; border:none; border-radius:6px;
    color:#fff; font:inherit; cursor:pointer; }
  #login button:hover { background:#2ea043; }
  #login .err { margin-top:10px; font-size:12px; }
</style>
</head>
<body>
<div class="titlebar"><span>quake-eew-server · 命令台</span><span id="conn">未登录</span></div>

<div id="login">
  <h2>地震预警后端 · 命令台</h2>
  <p>请输入管理员账号密码验证后使用（防止公网地址被他人滥用推送）</p>
  <input id="u" type="text" placeholder="账号" autocomplete="username">
  <input id="p" type="password" placeholder="密码" autocomplete="current-password">
  <button id="btn">登 录</button>
  <div class="err" id="lerr"></div>
</div>

<div id="term" style="display:none"></div>
<div id="inputrow" style="display:none">
  <span id="prompt">quake&gt;</span>
  <input id="inp" autocomplete="off" autocapitalize="off" spellcheck="false">
</div>

<script>
var login=document.getElementById('login'), term=document.getElementById('term'),
    conn=document.getElementById('conn'), inputrow=document.getElementById('inputrow'),
    inp=document.getElementById('inp'), u=document.getElementById('u'), p=document.getElementById('p'),
    lerr=document.getElementById('lerr'), btn=document.getElementById('btn');

function add(text, cls){ var d=document.createElement('div'); d.className='line '+(cls||'');
  d.textContent=text; term.appendChild(d); term.scrollTop=term.scrollHeight; }

var token='';
try { token=localStorage.getItem('qcmd_token')||''; } catch(e){}
var ws=null;

function showTerm(){
  login.style.display='none'; term.style.display='block'; inputrow.style.display='flex';
  conn.textContent='连接中…';
  var proto=location.protocol==='https:'?'wss':'ws';
  ws=new WebSocket(proto+'://'+location.host+'/cmd-ws?token='+encodeURIComponent(token));
  ws.onopen=function(){ conn.textContent='已连接';
    add('已连接命令台。输入 help 查看命令。','cmd'); inp.disabled=false; inp.focus(); };
  ws.onmessage=function(ev){ add(ev.data); };
  ws.onclose=function(e){
    conn.textContent='未登录';
    token=''; try{ localStorage.removeItem('qcmd_token'); }catch(x){}
    login.style.display='block'; term.style.display='none'; inputrow.style.display='none';
    lerr.textContent='连接已断开，请重新登录';
  };
  ws.onerror=function(){ ws.close(); };
}

function doLogin(){
  lerr.textContent='';
  var username=u.value.trim(), password=p.value;
  if(!username || !password){ lerr.textContent='请输入账号和密码'; return; }
  btn.disabled=true; btn.textContent='验证中…';
  fetch('/api/cmd/login', { method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({username:username, password:password}) })
  .then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j}; }); })
  .then(function(res){
    btn.disabled=false; btn.textContent='登 录';
    if(res.ok && res.j.token){
      token=res.j.token;
      try{ localStorage.setItem('qcmd_token', token); }catch(e){}
      showTerm();
    } else {
      lerr.textContent=(res.j && res.j.message)||'账号或密码错误';
    }
  })
  .catch(function(){ btn.disabled=false; btn.textContent='登 录';
    lerr.textContent='网络错误，请重试'; });
}
btn.addEventListener('click', doLogin);
u.addEventListener('keydown', function(e){ if(e.key==='Enter') p.focus(); });
p.addEventListener('keydown', function(e){ if(e.key==='Enter') doLogin(); });

// 已有有效 token 直接进终端；否则等登录
fetch('/api/cmd/config').then(function(r){ return r.json(); }).then(function(j){
  if(token && j.login){ showTerm(); } else { login.style.display='block'; }
}).catch(function(){ login.style.display='block'; });

inp.addEventListener('keydown', function(e){
  if(e.key!=='Enter') return;
  var v=inp.value.trim(); if(!v) return;
  add('quake> '+v,'cmd'); inp.value='';
  if(v==='clear'||v==='cls'){ term.innerHTML=''; return; }
  if(v==='exit'||v==='quit'){ return; }
  if(ws && ws.readyState===1){ ws.send(v); } else { add('未连接','err'); }
});
</script>
</body>
</html>`;

function start(app, server, agg, status, wss, extra) {
  commands.bind(agg, Object.assign({ status, wss }, extra || {}));

  // 根路径：浏览器给终端页，脚本/接口探测给纯文本
  app.get('/', (req, res) => {
    if (req.accepts('html')) {
      res.type('html').send(PAGE);
    } else {
      res.type('text').send('quake-eew-server is running. 网页命令台请用浏览器打开本地址。健康检查: GET /health');
    }
  });

  // 登录状态探测
  app.get('/api/cmd/config', (req, res) => {
    res.json({ login: loginRequired() });
  });

  // 登录：校验账号密码，发放 24h token
  app.post('/api/cmd/login', (req, res) => {
    const body = req.body || {};
    if (!loginRequired()) {
      return res.status(503).json({ ok: false, message: '后端未配置命令台账号，请联系管理员设置 CMD_USER/CMD_PASSWORD' });
    }
    if (String(body.username || '') === config.cmdUser && String(body.password || '') === config.cmdPassword) {
      return res.json({ ok: true, token: newToken() });
    }
    res.status(401).json({ ok: false, message: '账号或密码错误' });
  });

  // 命令通道：noServer 模式 + 手动 upgrade 路由（避免与预警 /ws 的多实例冲突）
  const cmdWs = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try { pathname = new URL(req.url, 'http://x').pathname; } catch (e) { return; }
    if (pathname !== '/cmd-ws') return; // 不是命令通道，交给预警 /ws 处理
    if (loginRequired()) {
      let tok = '';
      try { tok = new URL(req.url, 'http://x').searchParams.get('token') || ''; } catch (e) {}
      if (!validToken(tok)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }
    cmdWs.handleUpgrade(req, socket, head, (ws) => {
      cmdWs.emit('connection', ws, req);
    });
  });
  cmdWs.on('connection', (ws) => {
    ws.send('quake-eew-server 命令台就绪。输入 help 查看命令。');
    ws.on('message', async (raw) => {
      const out = await commands.handle(String(raw || ''), status, wss);
      if (out) {
        try { ws.send(out); } catch (e) {}
      }
    });
  });
}

module.exports = { start };
