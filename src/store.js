/**
 * 极简文件存储：设备列表、应急资料备份。
 * 数据量很小（设备 registrationId、联系人/个人信息），用 JSON 文件即可，
 * 不依赖数据库，免费 VPS / PaaS 都能跑；带防抖批量写盘。
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');

function ensureDir() {
  try { fs.mkdirSync(config.dataDir, { recursive: true }); } catch (e) {}
}

class JsonTable {
  constructor(file) {
    this.file = path.join(config.dataDir, file);
    this.data = {};
    this._timer = null;
    this._load();
  }

  _load() {
    ensureDir();
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.data = JSON.parse(raw || '{}');
    } catch (e) {
      this.data = {};
    }
  }

  get(key) { return this.data[key]; }
  all() { return this.data; }
  set(key, value) {
    this.data[key] = value;
    this._scheduleSave();
  }
  del(key) {
    delete this.data[key];
    this._scheduleSave();
  }

  _scheduleSave() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.saveNow();
    }, 500);
  }

  saveNow() {
    ensureDir();
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (e) {
      // 个别只读文件系统(部分PaaS)无法写盘：仅保留内存数据，重启后丢失，不影响主流程
      console.warn('[store] 无法写入文件，本次仅保存在内存：', e.message);
    }
  }
}

const devices = new JsonTable('devices.json');   // registrationId -> 设备信息
const profiles = new JsonTable('profiles.json'); // uid -> 应急资料备份

module.exports = { devices, profiles };
