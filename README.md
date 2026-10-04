# 地震预警后端 quake-eew-server（免费版 · 保姆级部署教程）

给「地震预警 App」用的免费后端，帮你做 4 件事：

1. **多数据源聚合保活**：同时连「Wolfx 实时 WebSocket」和「中国地震台网速报轮询」，一个挂了另一个兜底，自动去重，再通过 WebSocket 秒级转发给 App。
2. **App 被杀也能收到**：活跃预警同时走**极光 JPush 离线推送**，把通知弹出来。
3. **地图 Key 藏到服务器**：腾讯地图 Key 只放在后端，App 里不再暴露，防止被盗刷。
4. **应急资料云备份**：紧急联系人 / 个人信息上传云端，换机输入「恢复码」找回。

> 全程免费、不要信用卡、不用在自己电脑上常开服务器。

---

## 你要准备的账号（都免费）

| 平台 | 用途 | 注册地址 |
|---|---|---|
| GitHub | 存放代码 | https://github.com/signup |
| Render | 免费跑后端 | https://dashboard.render.com/register （可用 GitHub 一键登录）|
| UptimeRobot | 每 5 分钟叫醒后端，防休眠 | https://uptimerobot.com/register |
| 极光 JPush | 离线推送（你已注册） | https://www.jiguang.cn/ |
| 腾讯位置服务 | 地图 / 逆地理 / 避难所（你已有 Key） | https://lbs.qq.com/ |

---

## 第 0 步（很重要）：给腾讯地图 Key 开通「WebServiceAPI」

后端在服务器上调用腾讯的「逆地理 / 避难所搜索 / IP 定位」，这些属于 **WebServiceAPI**，需要手动开通，否则接口会报 `199 此key未开启WebserviceAPI功能`。

1. 打开腾讯位置服务控制台「我的应用」：https://lbs.qq.com/dev/console/application/mine
2. 找到你那个 Key（`7CCBZ` 开头），点右侧「**编辑**」。
3. 在「启用产品」里勾选「**WebServiceAPI**」（有的写 WebService API），保存。
4. **授权 IP 白名单请留空 / 不限制**：Render 服务器的 IP 会变，填了反而调不通；Key 只放在服务器环境变量里、别人看不到，是安全的。
5. 保存后等几分钟生效。

---

## 第 1 步：把代码传到 GitHub（网页拖拽，不用敲命令）

1. 登录 https://github.com ，右上角 **`+` → `New repository`**。
2. `Repository name` 填 **`quake-eew-server`**；选 **Public**；下面的「Add a README」**不要勾**；点 **Create repository**。
3. 创建后，在页面中间找到「**uploading an existing file**」蓝色链接，点它。
4. 把我发你的压缩包 **解压**，进入解压出来的文件夹，**全选里面的文件和文件夹**（`src` 文件夹、`package.json`、`package-lock.json`、`render.yaml`、`.env.example`、`.gitignore`、`README.md`），**一起拖进网页的上传框**。
   - 压缩包里**没有** `node_modules`（Render 会自己安装，不用传）。
   - 压缩包里**没有** `.env`（你的密钥不能传上网，稍后在 Render 里单独填）。
   - 如果系统默认不显示 `.` 开头的文件，`.gitignore`、`.env.example` 没传上也没关系，不影响部署；但 `src`、`package.json`、`render.yaml` 必须在。
5. 拖好后拉到页面最下面，点绿色按钮 **`Commit changes`** 提交。

---

## 第 2 步：在 Render 上部署（免费）

1. 打开 https://dashboard.render.com ，用 GitHub 登录。
2. 右上角 **`New +` → `Web Service`**。
3. 第一次会让你授权 GitHub，点 **Connect GitHub / 授权**，然后在仓库列表里选 **`quake-eew-server`**，点 **Connect**。
4. 因为代码里带了 `render.yaml`，Render 一般会自动识别并填好：
   - Runtime：**Node**
   - Branch：**main**（或 master，默认即可）
   - Build Command：**`npm install`**
   - Start Command：**`npm start`**
   - Instance Type：**Free（免费）** ← 一定选这个
5. 找到 **Environment / 环境变量**（Advanced 里），逐个「Add Environment Variable」添加下面 4 个：

   | Key（变量名） | Value（填什么） |
   |---|---|
   | `TENCENT_MAP_KEY` | 你的腾讯地图 Key（`7CCBZ` 开头那一长串）|
   | `JPUSH_APPKEY` | 极光 AppKey |
   | `JPUSH_MASTER_SECRET` | 极光 Master Secret |
   | `JPUSH_API_BASE` | `https://api.jiguang.cn`（国内；若部署后日志显示极光连不上/超时，改成 `https://api.jpush.io`）|

   > `PORT`、`NODE_VERSION` 不用你填（系统 / render.yaml 已处理）。
6. 点底部 **Create Web Service / Deploy**，开始部署，等 **2～5 分钟**。
7. 日志里出现下面这几行就是成功了：
   ```
   quake-eew-server 已启动
   HTTP : https://0.0.0.0:xxxx/health
   [wolfx] 已连接: wss://ws-api.wolfx.jp/fj_eew
   [cenc] 首次拉取，建立基线 xx 条
   ```
8. 页面顶部会给你一个网址，形如 `https://quake-eew-server-xxxx.onrender.com`。
   浏览器打开 **`https://你的网址/health`**，看到 `{"ok":true,...}` 就大功告成。
   - 免费实例长时间没人访问会休眠，**第一次打开 / 休眠后第一次打开要等 30～60 秒**冷启动，属正常现象，下一步就是解决它。

---

## 第 3 步：用 UptimeRobot 定时叫醒（防止休眠）

1. 注册并登录 https://uptimerobot.com （免费版即可）。
2. 点 **`+ Add New Monitor`**：
   - **Monitor Type**：选 `HTTP(s)`
   - **Friendly Name**：随便填，比如 `quake-eew`
   - **URL**：填 **`https://你的后端网址/health`**（一定带上 `/health`）
   - **Monitoring Interval**：选 **5 minutes**
3. 点 **Create Monitor** 保存。
   之后它每 5 分钟访问一次，后端就基本不会休眠了。

---

## 第 4 步：把后端网址发给我

把你 Render 给的网址（`https://xxxx.onrender.com`）发给我，我来改 App 并打新 APK：

- 实时预警 WebSocket 从「直连 Wolfx」改成连 `wss://你的网址/ws`；
- 地图 / 逆地理 / 避难所 / IP 定位改走你的 `/api/map/*`，并从 App 里**移除明文 Key**；
- 集成极光 Android SDK：App 启动自动注册设备、被杀也能收到通知、点通知直接弹预警界面；
- 云备份：生成恢复码、自动上传 / 换机恢复。

---

## （可选）在自己电脑上本地运行

需要 Node.js 20 或以上：https://nodejs.org

```bash
npm install
# Windows:  copy .env.example .env   然后编辑 .env 填值
# Mac/Linux: cp .env.example .env    然后编辑 .env 填值
npm start
```

打开 http://localhost:3000/health 看到 `{"ok":true}` 即可。

---

## 接口一览

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/health` | 健康检查（UptimeRobot 就 ping 它）|
| WebSocket | `/ws` | 实时接收 `fj_eew` 预警报文 |
| GET | `/api/alerts?limit=30` | 最近地震列表 |
| GET | `/api/map/geocode?lat=&lng=` | 逆地址解析（坐标→地址）|
| GET | `/api/map/poi?lat=&lng=&keyword=&radius=` | 周边 POI（应急避难场所）|
| GET | `/api/map/ip` | IP 城市级定位兜底 |
| POST | `/api/devices` | 注册设备 `{registrationId,platform,model}` |
| POST | `/api/devices/heartbeat` | 设备心跳 |
| DELETE | `/api/devices/:regId` | 注销设备 |
| GET | `/api/devices` | 已注册设备数量 |
| GET | `/api/cenc` | 台网速报列表代理（App 列表页/近 7 天地图用）|
| GET | `/api/profile/:uid` | 读取云备份（uid=恢复码）|
| PUT | `/api/profile/:uid` | 上传云备份 `{contacts,profile}` |

---

## 交互式命令台（模拟实验 / 远程推送）

后端跑起来后，有**两个**命令台，都能用下面这 26 条指令：

**① 网页命令台（长得像 CMD 的黑窗口，手机上也能用）**
- 浏览器打开你的公网地址：`https://你的后端网址/`（就是首页）
- 会看到一个黑色终端页面，先输入账号密码登录（账号密码在 `.env` 里配 `CMD_USER` / `CMD_PASSWORD`）
- 登录后输入 `help` 就能看到全部命令，在任何有网的地方都能远程推送，不用碰服务器终端

**② 终端命令台（服务器终端窗口）**
- 在运行 `npm start` 的那个终端窗口里直接输入命令，像 CMD 一样

**26 条指令一览：**

| 命令 | 说明 |
|---|---|
| `help [命令]` | 显示全部命令，或查看某个命令的详细用法 |
| `sim 泸州 5.5` | 按**地名**模拟地震（自动查坐标，地名可有空格）|
| `sim 6.2 31.23 121.47 10 上海` | 按**坐标**模拟：震级 纬度 经度 [深度] [地名] |
| `recent [N]` | 查看最近 N 条事件（默认 10 条）|
| `status` | 查看服务状态（运行时长/在线设备/数据源）|
| `devices` | 查看已注册到极光的设备列表 |
| `push 地名 震级` | 只触发一次极光**离线推送**（不广播，验证手机被杀也能收到）|
| `notify <文本>` | 向所有已注册设备推送一条自定义文本通知 |
| `broadcast <文本>` | 向所有**在线 App** 广播一条消息 |
| `locate <地名>` | 查询地名坐标（不注入地震）|
| `wolfx on\|off` | 开/关 Wolfx 实时数据源（动态生效）|
| `cenc on\|off` | 开/关台网速报轮询（动态生效）|
| `sources` | 查看数据源实时状态 |
| `config` | 查看服务配置 |
| `time` | 显示服务器北京时间 |
| `uptime` | 显示运行时长与内存占用 |
| `version` | 显示版本信息 |
| `clearalerts` | 清空最近事件列表 |
| `echo <文本>` | 原样回显（测试命令台连通）|
| `ping` | 连通测试，返回 pong 与时间 |
| `clear` | 清空屏幕 |
| `cls` | 清空屏幕（同 clear）|
| `exit` | 断开命令台连接 |
| `quit` | 退出命令台（同 exit）|
| `stats` | 查看统计（累计注入/极光推送/广播次数）|
| `reboot` | 重启数据源连接（Wolfx + 台网轮询，无需重启进程）|
| `env` | 查看当前环境配置摘要 |

模拟走的是与真实预警**完全相同**的链路：注入 `fj_eew` 报文 → 判定活跃 → WS 广播给在线 App（立即弹窗）→ 极光离线推送（App 被杀也能收到通知，点击弹详情）。适合做地震预警演练。注意：模拟会真实推送到你已注册的每台设备，请按需使用。

---

## 安全与合规（务必遵守）

- 本后端**只转发**中国地震台网 / 公开数据源的信息，**不自己预测、不伪造、不篡改预警**；App 名称与文案不要冒充官方机构。
- 所有密钥（腾讯 Key、极光 AppKey / Master Secret）**只填在 Render 的环境变量里**，绝不写进代码、不传到 GitHub；`.env` 已被 `.gitignore` 排除。
- 如想给接口加访问口令：在 Render 加环境变量 `AUTH_TOKEN`=你自定义的密码，请求时带头 `x-auth-token: 密码`；个人用默认留空即可。

---

## 关于免费服务器「数据可能被清空」

Render 免费版的磁盘是**临时**的，重新部署 / 实例回收后，`data` 里的设备表和云备份可能被清空：

- **设备表会自愈**：App 每次启动都会自动重新注册极光 registrationId；
- **云备份**：App 本地始终保留一份主数据、每次打开自动重新上传；仅在「后端刚被清空、又恰好在新机恢复」的极端情况下可能恢复不到。
- 想要 100% 持久不丢，下一步可以免费接 **Supabase** 数据库，到时候我再带你配置（先把当前版本跑通，不必一次弄太多）。

---

## 常见问题排查

- **地图接口返回 `199 未开启WebserviceAPI`** → 回「第 0 步」开通，注意 IP 白名单留空。
- **极光返回 401 / 403 / code 1009** → AppKey 或 Master Secret 复制错了 / 带了空格，回极光「设置 & 密钥」重新复制；海外节点连不通就把 `JPUSH_API_BASE` 改成 `https://api.jpush.io`。
- **`/health` 第一次打开很慢或 502** → 免费实例冷启动，等 1 分钟刷新；配好 UptimeRobot 后基本不睡。
- **改了代码怎么更新** → 在 GitHub 网页上传/替换文件并 Commit，Render 会自动重新部署（render.yaml 里 autoDeploy 已开启）。
- **日志里 Wolfx 断开重连** → 正常，程序会自动重连；只要 `/health` 里 `wolfx` 偶尔为 true、`cenc.count` 有数即可。
