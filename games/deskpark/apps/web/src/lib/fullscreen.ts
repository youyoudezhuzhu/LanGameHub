import { useSyncExternalStore } from 'react';
import { toast } from '../components/ui';

/**
 * 全屏与屏幕方向：所有玩法共用。
 *
 * 全屏只在浏览器允许时才生效（Android Chrome / Edge、桌面浏览器可以；
 * iPhone Safari 不支持任意元素全屏，会走到提示分支）。全屏后如果能锁定方向，
 * 由调用方决定要不要锁：棋牌类玩法保持可旋转，射击类（港区防线）才锁横屏。
 */

type OrientationLock = (mode: 'any' | 'landscape' | 'portrait') => Promise<void>;

interface LockableOrientation extends ScreenOrientation {
  lock?: OrientationLock;
}

/** Safari 上的旧前缀 API（不受 TS DOM 类型覆盖） */
interface LegacyDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface LegacyElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

let bound = false;
function bind(): void {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('fullscreenchange', emit);
  document.addEventListener('webkitfullscreenchange', emit);
}

function subscribe(listener: () => void): () => void {
  bind();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 当前全屏元素（没有就是 null） */
export function fullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const doc = document as LegacyDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** 订阅全屏状态；返回是否处于全屏 */
export function useFullscreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => fullscreenElement() !== null,
    () => false,
  );
}

/** 浏览器是否支持把任意元素全屏（iPhone Safari 不支持） */
export function fullscreenSupported(el?: HTMLElement | null): boolean {
  if (typeof document === 'undefined') return false;
  const target = el ?? document.documentElement;
  return Boolean(target.requestFullscreen ?? (target as LegacyElement).webkitRequestFullscreen);
}

/** 锁定屏幕方向；需要先进入全屏，失败时静默返回 false */
export async function lockOrientation(mode: 'any' | 'landscape' | 'portrait'): Promise<boolean> {
  const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as
    LockableOrientation | undefined;
  if (!orientation?.lock) return false;
  try {
    await orientation.lock(mode);
    return true;
  } catch {
    return false;
  }
}

/** 退出全屏（同时解除方向锁定） */
export async function exitFullscreen(): Promise<boolean> {
  if (!fullscreenElement()) return true;
  await lockOrientation('any');
  try {
    const doc = document as LegacyDocument;
    if (doc.exitFullscreen) await doc.exitFullscreen();
    else await doc.webkitExitFullscreen?.();
    return true;
  } catch {
    return false;
  }
}

/**
 * 进入全屏。传 orientation 时尝试锁定方向（只有射击类玩法需要）。
 * 返回是否成功进入全屏；不支持全屏的浏览器返回 false。
 */
export async function enterFullscreen(
  el: HTMLElement | null,
  orientation: 'landscape' | 'portrait' | null = null,
): Promise<boolean> {
  const target = (el ??
    (typeof document === 'undefined' ? null : document.documentElement)) as LegacyElement | null;
  if (!target) return false;
  if (fullscreenElement()) return true;
  const request =
    target.requestFullscreen?.bind(target) ?? target.webkitRequestFullscreen?.bind(target);
  if (!request) return false;
  try {
    await request();
  } catch {
    return false;
  }
  if (orientation) await lockOrientation(orientation);
  return fullscreenElement() !== null;
}

/**
 * 切换全屏，失败时提示玩家。
 * `orientation` 只在开始全屏时尝试锁定（棋牌类传 null 表示跟着手机转）。
 * 返回切换之后是否处于全屏。
 */
export async function toggleFullscreen(
  el: HTMLElement | null,
  orientation: 'landscape' | 'portrait' | null = null,
): Promise<boolean> {
  if (fullscreenElement()) {
    const ok = await exitFullscreen();
    if (!ok) toast('浏览器未允许退出全屏');
    return false;
  }
  if (!fullscreenSupported(el)) {
    toast('当前浏览器不支持全屏，可把本站添加到主屏幕后全屏使用');
    return false;
  }
  const ok = await enterFullscreen(el, orientation);
  if (!ok) toast('浏览器未允许全屏');
  return ok;
}
