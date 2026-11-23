import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { networkInterfaces } from 'node:os';

export function localPeer(req: IncomingMessage): boolean {
  const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  if (ip === '::1' || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip))
    return true;
  // Also accept a directly connected Android hotspot on another IPv4 subnet.
  const number = (value: string) => value.split('.').reduce((bits, part) => (bits << 8) | Number(part), 0);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  return Object.values(networkInterfaces()).some((entries) => entries?.some((item) =>
    item.family === 'IPv4' && !item.internal &&
    (number(item.address) & number(item.netmask)) === (number(ip) & number(item.netmask)),
  ));
}

export function allowedHost(req: IncomingMessage): boolean {
  const host = req.headers.host?.toLowerCase().replace(/:\d+$/, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
  return !!host && (host === req.socket.localAddress ||
    Object.values(networkInterfaces()).some((entries) => entries?.some((item) => item.address === host)));
}

export function sameOrigin(req: IncomingMessage): boolean {
  const host = req.headers.host;
  return !!host && req.headers.origin === `http://${host}`;
}

export function isAdmin(req: IncomingMessage): boolean {
  const secret = process.env.LAN_HUB_SECRET;
  const header = req.headers.authorization;
  if (!secret || !header || req.socket.remoteAddress !== '127.0.0.1') return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
