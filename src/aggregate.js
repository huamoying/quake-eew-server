/**
 * 多源聚合：把不同数据源的地震事件统一成 App 认识的 fj_eew 报文结构，
 * 去重、缓存最近 N 条，并在“活跃(发报5分钟内)”时向外广播 + 触发离线推送。
 *
 * 统一后的事件字段（与 App 原生解析完全一致，App 端只认这些大写字段）：
 *   type:"fj_eew"、ReportTime、Magnitude、Latitude、Longitude、
 *   Depth、HypoCenter、MaxIntensity
 * 下划线开头的 _source/_id/_ts 是后端内部字段，App 会自动忽略。
 */
const { EventEmitter } = require('events');
const config = require('./config');

const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 与 App 保持一致：发报 5 分钟内才算活跃预警

/** 按北京时间(UTC+8)解析 "yyyy-MM-dd HH:mm:ss"，返回毫秒时间戳 */
function parseShanghaiTime(t) {
  if (!t) return 0;
  const s = String(t).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})/);
  if (m) {
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +m[6]);
  }
  const d = Date.parse(s.replace(/-/g, '/'));
  return Number.isNaN(d) ? 0 : d;
}

class Aggregator extends EventEmitter {
  constructor() {
    super();
    this.recent = [];      // 最近事件，新的在前
    this.seen = new Map(); // 去重 key -> 首次见到的时间戳(ms)
  }

  /** 生成与 App 一致的去重键 */
  keyOf(e) {
    return `${e.ReportTime}@${e.Magnitude}@${e.Latitude},${e.Longitude}`;
  }

  /**
   * 接收一条已标准化的事件
   * @returns {'alert'|'recent'|'duplicate'|'invalid'}
   *  alert     -> 活跃新事件，已 emit('alert')，应广播+离线推送
   *  recent    -> 仅进入最近列表（旧震，不打扰）
   *  duplicate -> 去重窗口内重复，丢弃
   *  invalid   -> 字段不合法，丢弃
   */
  ingest(raw, source) {
    if (!raw || raw.type !== 'fj_eew') return 'invalid';
    const mag = Number(raw.Magnitude);
    const lat = Number(raw.Latitude);
    const lng = Number(raw.Longitude);
    const ts = parseShanghaiTime(raw.ReportTime);
    if (!raw.ReportTime || !ts || !(mag > 0) || !(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
      return 'invalid';
    }

    const e = {
      type: 'fj_eew',
      ReportTime: raw.ReportTime,
      Magnitude: mag,
      Latitude: lat,
      Longitude: lng,
      Depth: Number(raw.Depth) || 10,
      HypoCenter: raw.HypoCenter || '未知区域',
      MaxIntensity: parseInt(raw.MaxIntensity, 10) || 0,
      _source: source || raw._source || 'unknown',
      _id: raw._id || '',
      _ts: ts,
    };

    const now = Date.now();
    // 清理过期去重键
    for (const [k, t] of this.seen) {
      if (now - t > config.dedupMs) this.seen.delete(k);
    }

    const key = this.keyOf(e);
    if (this.seen.has(key) && now - this.seen.get(key) < config.dedupMs) {
      return 'duplicate';
    }
    this.seen.set(key, now);

    // 入最近列表（同一 key 不重复保留）
    if (!this.recent.some((x) => this.keyOf(x) === key)) {
      this.recent.push(e);
      this.recent.sort((a, b) => b._ts - a._ts);
      if (this.recent.length > config.maxRecentAlerts) {
        this.recent.length = config.maxRecentAlerts;
      }
    }

    // 仅活跃事件才实时告警（旧震只进列表，App 端同样会过滤，这里也避免无谓推送）
    if (now - ts <= ACTIVE_WINDOW_MS) {
      this.emit('alert', e);
      return 'alert';
    }
    return 'recent';
  }

  getRecent(limit) {
    const n = Math.min(limit || config.maxRecentAlerts, this.recent.length);
    return this.recent.slice(0, n);
  }

  /** 清空最近事件列表（命令台 clearalerts） */
  clearRecent() {
    this.recent = [];
  }
}

module.exports = { Aggregator, parseShanghaiTime };
