import { startServer } from './server';

const port = Number(process.env.PORT) || 8787;
const turnTimeoutMs = Number(process.env.TURN_TIMEOUT_MS) || 30_000;

const server = startServer({
  port,
  lanOnly: process.env.LAN_HUB === '1',
  host: process.env.HOST,
  staticDir: process.env.STATIC_DIR,
  config: {
    turnTimeoutMs,
    log: (...args) => {
      if (process.env.LAN_HUB_VERBOSE !== '0' || args[0] !== '[room]')
        console.log(new Date().toISOString(), ...args);
    },
  },
});

server.ready.then((p) => {
  console.log(`🏯 闲亭服务器已启动  http://localhost:${p}   (WebSocket: /ws)`);
  console.log(`   静态资源目录: ${server.staticDir}`);
}).catch((error) => {
  console.error('[startup]', error);
  process.exitCode = 1;
  void server.close();
});

// 联机状态全在内存里：单个请求出错时记录下来继续服务，而不是让所有对局随进程一起中断
process.on('uncaughtException', (e) => console.error(new Date().toISOString(), '[uncaught]', e));
process.on('unhandledRejection', (e) => console.error(new Date().toISOString(), '[unhandled]', e));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close().finally(() => process.exit(0));
  });
}
