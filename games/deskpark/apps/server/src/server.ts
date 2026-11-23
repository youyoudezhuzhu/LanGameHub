import type { ServerMessage } from '@park/protocol';
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { handleAiProxy, isAiProxyPath } from './aiProxy';
import { clientIp } from './net';
import { allowedHost, isAdmin, localPeer, sameOrigin } from './lan';
import type { ServerConfig } from './rooms';
import { DEFAULT_CONFIG, Hub } from './rooms';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

export interface StartOptions {
  port: number;
  host?: string;
  staticDir?: string | null;
  config?: Partial<ServerConfig>;
  lanOnly?: boolean;
}

function defaultStaticDir(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return resolve(here, '../../web/dist');
}

/**
 * 网页的安全响应头：只允许同源脚本；连接（AI 接口、联机服务器）不限来源。
 * 跨域隔离（COOP + COEP）让棋类导师的多线程引擎（Fairy-Stockfish）可以使用 SharedArrayBuffer；
 * 页面的资源都来自本站，不受影响。
 */
const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': [
    "default-src 'self'",
    // WebAssembly 引擎需要 wasm-unsafe-eval（只允许编译 wasm，不放开 eval）
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    'connect-src * ws: wss:',
    "manifest-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

function serveStatic(root: string, req: IncomingMessage, res: ServerResponse, strict: boolean): void {
  let rel: string;
  try {
    rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }
  if (strict && (!rel.startsWith('/') || rel.startsWith('//') || /[\\\u0000-\u001f]/.test(rel) ||
      rel.split('/').some((part) => part.startsWith('.')))) {
    res.writeHead(400);
    res.end();
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(root, rel));
  const inside = file.startsWith(root + sep);
  const target = strict || (inside && existsSync(file) && statSync(file).isFile())
    ? file : join(root, 'index.html');
  if ((strict && !inside) || !existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('资源不存在');
    return;
  }
  const ext = extname(target);
  const immutable = target.startsWith(join(root, 'assets') + sep);
  // 导师用的棋类引擎（几 MB）：很少更新，缓存一周，免得每次打开都重新下载
  const engine = target.startsWith(join(root, 'engines') + sep);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable
      ? 'public, max-age=31536000, immutable'
      : engine
        ? 'public, max-age=604800'
        : 'no-cache',
    ...SECURITY_HEADERS,
    ...(process.env.LAN_HUB === '1' ? {
      'content-security-policy': SECURITY_HEADERS['content-security-policy']
        .replace('connect-src * ws: wss:', `connect-src 'self' ws://${req.headers.host}`),
    } : {}),
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(target)
    .on('error', () => res.destroy())
    .pipe(res);
}

export function startServer(opts: StartOptions) {
  const config: ServerConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const hub = new Hub(config);
  const staticDir = opts.staticDir === null ? null : resolve(opts.staticDir ?? defaultStaticDir());

  const http = createHttpServer({ requestTimeout: 12000, headersTimeout: 8000 }, (req, res) => {
    if (opts.lanOnly && (!localPeer(req) || !allowedHost(req))) {
      res.writeHead(403).end();
      return;
    }
    if (opts.lanOnly && req.url?.startsWith('/api/host')) {
      if (!isAdmin(req)) {
        res.writeHead(403).end();
        return;
      }
      if (req.method === 'GET' && req.url === '/api/host') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({
          service: 'LAN Game Hub', ...hub.stats(), sockets: wss.clients.size,
          rss: process.memoryUsage().rss, uptime: Math.floor(process.uptime()),
          roomList: hub.roomSummaries(),
        }));
        return;
      }
      const match = /^\/api\/host\/rooms\/([A-Z0-9]{4})$/.exec(req.url);
      if (req.method === 'DELETE' && match) {
        res.writeHead(hub.closeRoom(match[1]) ? 204 : 404).end();
        return;
      }
      res.writeHead(404).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && opts.lanOnly) {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    if (req.url === '/healthz' || req.url === '/api/status') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: true, ...hub.stats() }));
      return;
    }
    if (!opts.lanOnly && isAiProxyPath(req.url)) {
      handleAiProxy(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      return;
    }
    if (!staticDir) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      serveStatic(staticDir, req, res, !!opts.lanOnly);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });

  http.maxConnections = 192;
  http.keepAliveTimeout = 5000;
  http.setTimeout(20000, (socket) => socket.destroy());
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  http.on('upgrade', (req, socket, head) => {
    const allowed = req.url === '/ws' && wss.clients.size < 96 &&
      (!opts.lanOnly || (allowedHost(req) && localPeer(req) && sameOrigin(req)));
    if (!allowed) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    req.socket.setTimeout(0);
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  // 每个 IP 的同时连接数上限，防止单个来源占满资源
  const perIp = new Map<string, number>();
  const maxPerIp = Number(process.env.MAX_CONN_PER_IP) || 20;
  wss.on('connection', (socket, req) => {
    const ip = opts.lanOnly ? req.socket.remoteAddress ?? '' : clientIp(req);
    const n = (perIp.get(ip) ?? 0) + 1;
    if (n > maxPerIp) {
      socket.close(1008, 'too many connections');
      return;
    }
    perIp.set(ip, n);
    socket.on('close', () => {
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left <= 0) perIp.delete(ip);
      else perIp.set(ip, left);
    });
    const send = (msg: ServerMessage) => {
      if (socket.bufferedAmount > 128 * 1024) socket.terminate();
      else if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };
    const { onMessage, onClose } = hub.connect(send, !opts.lanOnly);
    // 简单限流：每秒最多 30 条消息
    let windowStart = Date.now();
    let count = 0;
    socket.on('message', (data) => {
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        count = 0;
      }
      if (++count > 30) return;
      onMessage(data.toString());
    });
    socket.on('close', onClose);
    socket.on('error', () => socket.close());
  });

  // 心跳：清理僵尸连接
  const alive = new WeakSet<object>();
  wss.on('connection', (socket) => {
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
  });
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!alive.has(socket)) {
        socket.terminate();
        continue;
      }
      alive.delete(socket);
      socket.ping();
    }
  }, 30_000);
  const sweeper = setInterval(() => hub.sweep(), 30_000);

  const ready = new Promise<number>((resolveReady, reject) => {
    http.once('error', reject);
    http.listen(opts.port, opts.host ?? '0.0.0.0', () => {
      http.removeListener('error', reject);
      const addr = http.address();
      resolveReady(typeof addr === 'object' && addr ? addr.port : opts.port);
    });
  });

  const close = async () => {
    clearInterval(heartbeat);
    clearInterval(sweeper);
    hub.dispose();
    for (const s of wss.clients) s.terminate();
    await new Promise<void>((r) => wss.close(() => r()));
    await new Promise<void>((r) => { http.close(() => r()); http.closeAllConnections(); });
  };

  return { hub, ready, close, staticDir };
}
