/**
 * 数据源二：中国地震台网速报（Wolfx 镜像 cenc_eqlist.json），定时轮询兜底。
 * 当 Wolfx 实时 WS 抽风/漏掉时，靠它补；首次拉取只建立基线、不回放历史地震。
 *
 * 返回形如：{ "No1": { time, magnitude, depth, latitude, longitude, location/new_di/placeName... }, ... }
 * 映射成 App 认识的 fj_eew 结构；只有“新出现且发报5分钟内”的才会真正告警。
 */
const config = require('../config');

function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    .finally(() => clearTimeout(t));
}

function rowKey(r) {
  return `${r.time}@${r.magnitude}@${r.latitude},${r.longitude}`;
}

function rowTime(r) {
  const t = Date.parse(String(r.time || '').replace(/-/g, '/'));
  return Number.isNaN(t) ? 0 : t;
}

function start(agg, status) {
  if (!config.enableCencPoll) {
    console.log('[cenc] 已通过 ENABLE_CENC_POLL=0 关闭');
    return null;
  }
  let known = null; // 首次拉取后建立已见集合

  const poll = async () => {
    try {
      const res = await fetchWithTimeout(config.cencListUrl, 10000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const rows = [];
      if (json && typeof json === 'object') {
        for (const k of Object.keys(json)) {
          if (/^No\d+$/.test(k) && json[k] && json[k].time) rows.push(json[k]);
        }
      }
      status.cenc.lastOk = Date.now();
      status.cenc.error = null;
      status.cenc.count = rows.length;
      if (!rows.length) return;

      rows.sort((a, b) => rowTime(b) - rowTime(a)); // 新的在前

      if (!known) {
        known = new Set(rows.map(rowKey));
        console.log('[cenc] 首次拉取，建立基线', rows.length, '条（不回放历史）');
        return;
      }

      let newCount = 0;
      // 从新到旧处理未见过的条目
      for (const r of rows) {
        const id = rowKey(r);
        if (known.has(id)) continue;
        known.add(id);
        newCount++;
        const e = {
          type: 'fj_eew',
          ReportTime: r.time,
          Magnitude: parseFloat(r.magnitude) || 0,
          Latitude: parseFloat(r.latitude) || 0,
          Longitude: parseFloat(r.longitude) || 0,
          Depth: parseFloat(r.depth) || 10,
          HypoCenter: r.location || r.placeName || '未知区域',
          MaxIntensity: parseInt(r.max_int || r.intensity || 0, 10) || 0,
          _source: 'cenc',
          _id: id,
        };
        const result = agg.ingest(e, 'cenc');
        if (result === 'alert') console.log('[cenc] 兜底活跃预警:', r.time, r.magnitude, e.HypoCenter);
      }
      if (newCount) console.log('[cenc] 本轮新增', newCount, '条');
    } catch (err) {
      status.cenc.error = String(err && err.message || err);
      console.warn('[cenc] 拉取失败:', status.cenc.error);
    }
  };

  poll();
  return setInterval(poll, config.cencPollMs);
}

/* ===== 命令台动态开关支持 ===== */
let timer = null;

function startTracked(agg, status) {
  if (timer) { clearInterval(timer); timer = null; }
  timer = start(agg, status);
  return !!timer;
}

function stopAll() {
  if (timer) { clearInterval(timer); timer = null; }
}

/** 命令台开关：on 启动 / off 停止（不重启进程） */
function setEnabled(agg, status, enabled) {
  config.enableCencPoll = !!enabled;
  if (enabled) return startTracked(agg, status);
  stopAll();
  return false;
}

module.exports = { start, startTracked, stopAll, setEnabled };
