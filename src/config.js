/**
 * 配置：所有密钥/开关都从环境变量(.env)读取，绝不写死在代码里。
 * 部署时在平台的“环境变量”里配置，或复制 .env.example 为 .env 填写。
 */
require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  authToken: process.env.AUTH_TOKEN || '', // 可选：App 访问后端的简单口令(Header: x-auth-token)，留空则不校验

  // 腾讯位置服务（地图 REST 代理用；Key 只放服务器，App 里不再带）
  tencentMapKey: process.env.TENCENT_MAP_KEY || '',

  // 数据源开关
  enableWolfx: (process.env.ENABLE_WOLFX || '1') !== '0',
  enableCencPoll: (process.env.ENABLE_CENC_POLL || '1') !== '0',
  cencPollMs: parseInt(process.env.CENC_POLL_MS || '8000', 10), // 台网速报轮询间隔(毫秒)
  // wolfx 频道：fj_eew(福建/大陆EEW镜像)。如需日本/台湾可再加 jma_eew/cwa_eew
  wolfxUrls: (process.env.WOLFX_URLS || 'wss://ws-api.wolfx.jp/fj_eew')
    .split(',').map((s) => s.trim()).filter(Boolean),
  cencListUrl: process.env.CENC_LIST_URL || 'https://api.wolfx.jp/cenc_eqlist.json',

  // 极光推送 JPush（App 被杀也能收到）。在极光控制台→应用设置里获取
  jpushAppKey: process.env.JPUSH_APPKEY || '',
  jpushMasterSecret: process.env.JPUSH_MASTER_SECRET || '',
  // 极光 REST 域名：国内应用用 https://api.jpush.cn ；海外应用用 https://api.jpush.io
  jpushApiBase: process.env.JPUSH_API_BASE || 'https://api.jpush.cn',

  // 网页命令台登录账号密码（不设置则命令台不可用，防止公网被滥用）
  cmdUser: process.env.CMD_USER || '',
  cmdPassword: process.env.CMD_PASSWORD || '',

  // 存储
  dataDir: process.env.DATA_DIR || require('path').join(__dirname, '..', 'data'),
  maxRecentAlerts: parseInt(process.env.MAX_RECENT_ALERTS || '30', 10),
  // 同一事件去重窗口(毫秒)：多源/重复报文在此窗口内视为同一条
  dedupMs: parseInt(process.env.DEDUP_MS || '120000', 10),
};

module.exports = config;
