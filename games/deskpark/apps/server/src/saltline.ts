import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RawData, WebSocket } from 'ws';

interface SaltlineRelay {
  onOpen(socket: WebSocket): void;
  onMessage(socket: WebSocket, data: RawData): void;
  onClose(socket: WebSocket): void;
  onPong(socket: WebSocket): void;
  lanInfo(): unknown;
  stats(): { sockets: number; rooms: number };
  roomSummaries(): { game: string; code: string; status: string; players: number; capacity: number }[];
  closeRoom(code: string): boolean;
  dispose(): void;
}

export function loadSaltline(staticDir: string, load: NodeJS.Require, log?: (...args: unknown[]) => void) {
  const web = join(staticDir, 'games/saltline');
  try {
    const { revision } = JSON.parse(readFileSync(join(web, 'hub-module.json'), 'utf8'));
    if (typeof revision !== 'string' || !/^[0-9a-f]{40}$/.test(revision) || !statSync(join(web, 'index.html')).isFile()) return null;
    const { createRoomServer } = load(join(staticDir, '..', 'saltline-relay.cjs'));
    return { revision: String(revision), relay: createRoomServer({ log }) as SaltlineRelay };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log?.('[Saltline]', error);
    return null;
  }
}
