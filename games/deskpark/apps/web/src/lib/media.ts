import { useSyncExternalStore } from 'react';

const COMPACT_QUERY = '(max-height: 500px)';
const PORTRAIT_QUERY = '(orientation: portrait)';

/** 订阅一个 media query 的变化 */
function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** 横屏手机等矮屏幕（高度 ≤ 500px） */
export function useCompact(): boolean {
  return useMedia(COMPACT_QUERY);
}

export type Orientation = 'portrait' | 'landscape';

/** 当前是竖屏还是横屏；旋转手机时会更新，用于切换两套布局 */
export function useOrientation(): Orientation {
  return useMedia(PORTRAIT_QUERY) ? 'portrait' : 'landscape';
}

/** 竖屏（手机竖着拿）：很多牌桌需要专门的竖排布局 */
export function usePortrait(): boolean {
  return useMedia(PORTRAIT_QUERY);
}

/** 视口尺寸（随旋转 / 缩放更新），需要精确像素时用它 */
export function useViewport(): { w: number; h: number } {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('resize', cb);
      window.addEventListener('orientationchange', cb);
      return () => {
        window.removeEventListener('resize', cb);
        window.removeEventListener('orientationchange', cb);
      };
    },
    read,
    () => ({ w: 0, h: 0 }),
  );
}

/** 大屏幕上的座位放大倍数：1440×860 以下为 1，最大 1.5 */
function seatScale(): number {
  const s = Math.min(window.innerWidth / 1440, window.innerHeight / 860);
  return Math.round(Math.min(1.5, Math.max(1, s)) * 20) / 20;
}

export function useSeatScale(): number {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('resize', cb);
      window.addEventListener('orientationchange', cb);
      return () => {
        window.removeEventListener('resize', cb);
        window.removeEventListener('orientationchange', cb);
      };
    },
    seatScale,
    () => 1,
  );
}
