/**
 * 应急资料云备份（免账号，用随机“恢复码 UID”隔离）。
 * App 首次使用生成一个长随机 UID（即恢复码）保存在本机；换机时在新机输入同一 UID 即可拉回。
 *   GET /api/profile/:uid  读取备份
 *   PUT /api/profile/:uid  覆盖备份  body: { contacts:[...], profile:{...} }
 *
 * 说明：免费托管(如 Render 免费版)的磁盘在重新部署/回收后可能清空，
 * App 本地始终保留一份主数据，并在每次打开时重新 PUT，云端用于换机恢复；
 * 后续可无缝换成 Supabase 等免费持久数据库（见 README）。
 */
const express = require('express');
const { profiles } = require('../store');

const router = express.Router();

function validUid(uid) {
  return typeof uid === 'string' && uid.length >= 8 && uid.length <= 128 && /^[A-Za-z0-9_-]+$/.test(uid);
}

router.get('/:uid', (req, res) => {
  const { uid } = req.params;
  if (!validUid(uid)) return res.status(400).json({ ok: false, message: '恢复码格式不正确' });
  const data = profiles.get(uid);
  if (!data) return res.status(404).json({ ok: false, message: '没有找到备份，请检查恢复码' });
  res.json({ ok: true, uid, data });
});

router.put('/:uid', (req, res) => {
  const { uid } = req.params;
  if (!validUid(uid)) return res.status(400).json({ ok: false, message: '恢复码格式不正确' });
  const body = req.body || {};
  const contacts = Array.isArray(body.contacts) ? body.contacts : [];
  const profile = body.profile && typeof body.profile === 'object' ? body.profile : {};
  const updatedAt = Date.now();
  profiles.set(uid, { contacts, profile, updatedAt });
  profiles.saveNow();
  res.json({ ok: true, uid, updatedAt });
});

module.exports = router;
