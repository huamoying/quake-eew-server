/**
 * 终端交互命令台（在运行 npm start 的终端里输命令）
 * 与网页版命令台共用 commands.js 的命令逻辑。
 * 命令：help / sim / recent / status / exit
 */
const readline = require('readline');
const commands = require('./commands');

function start(agg, status, wss, extra) {
  // 非交互终端（后台运行 / 无输入通道）不启动 CLI，
  // 避免 stdin 立即 close 触发 process.exit 把整个服务带崩；网页命令台不受影响。
  if (!process.stdin.isTTY) return;
  commands.bind(agg, Object.assign({ status, wss }, extra || {}));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('');
  console.log('==============================================');
  console.log(' 交互式命令台已开启：输入 help 查看命令');
  console.log(' 输入 sim 泸州 5.5 可立即模拟泸州 5.5 级地震，');
  console.log(' APP 端会像真实预警一样弹出警报。');
  console.log('==============================================');
  rl.on('line', async (line) => {
    const out = await commands.handle(line, status, wss);
    if (out) console.log(out);
  });
  rl.on('close', () => process.exit(0));
}

module.exports = { start };
