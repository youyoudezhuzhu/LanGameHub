import { Zap } from 'lucide-react';
import type { PointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { snakeArena } from '@park/engine';

type Direction = snakeArena.Direction;
type Input = snakeArena.SnakeInput;

const byKey: Record<string, Direction> = {
  ArrowUp: 'north', w: 'north', ArrowDown: 'south', s: 'south',
  ArrowLeft: 'west', a: 'west', ArrowRight: 'east', d: 'east',
};

export function SnakeControls({ enabled, send }: { enabled: boolean; send(input: Input): void }) {
  const current = useRef({ enabled, send });
  const stick = useRef<number | null>(null);
  const boostPointer = useRef<number | null>(null);
  const boostKey = useRef(false);
  const direction = useRef<Direction | null>(null);
  const [offset, setOffset] = useState([0, 0]);
  const [boosting, setBoosting] = useState(false);
  useEffect(() => { current.current = { enabled, send }; }, [enabled, send]);

  function emit(input: Omit<Input, 'type'>) {
    if (current.current.enabled) current.current.send({ type: 'steer', ...input });
  }

  function updateBoost() {
    const boost = boostPointer.current !== null || boostKey.current;
    setBoosting(boost);
    emit({ boost });
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - box.left - box.width / 2;
    const dy = event.clientY - box.top - box.height / 2;
    const limit = box.width * 0.28;
    const length = Math.hypot(dx, dy);
    const scale = Math.min(1, limit / Math.max(1, length));
    setOffset([dx * scale, dy * scale]);
    if (length < 9) {
      direction.current = null;
      return;
    }
    const next = Math.abs(dx) >= Math.abs(dy)
      ? (dx < 0 ? 'west' : 'east') : (dy < 0 ? 'north' : 'south');
    if (next !== direction.current) {
      direction.current = next;
      emit({ direction: next });
    }
  }

  function releaseStick(event: PointerEvent) {
    if (stick.current !== event.pointerId) return;
    stick.current = null;
    direction.current = null;
    setOffset([0, 0]);
  }

  function releaseBoost(event: PointerEvent) {
    if (boostPointer.current !== event.pointerId) return;
    boostPointer.current = null;
    updateBoost();
  }

  function handleKeys(event: KeyboardEvent, pressed: boolean) {
    const target = event.target;
    if (target instanceof HTMLElement &&
      (target.closest('dialog, [role="dialog"], input, textarea, select') || target.isContentEditable)) return;
    if (!current.current.enabled) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (byKey[key] && pressed) {
      event.preventDefault();
      if (!event.repeat) emit({ direction: byKey[key] });
    } else if (key === ' ' && event.shiftKey === false &&
      (!(target instanceof HTMLButtonElement) || target.dataset.snakeControl !== undefined)) {
      event.preventDefault();
      if (boostKey.current !== pressed) {
        boostKey.current = pressed;
        updateBoost();
      }
    }
  }

  useEffect(() => {
    const down = (event: KeyboardEvent) => handleKeys(event, true);
    const up = (event: KeyboardEvent) => {
      if (event.key === ' ' && boostKey.current) {
        boostKey.current = false;
        updateBoost();
      } else handleKeys(event, false);
    };
    const reset = () => {
      stick.current = null;
      direction.current = null;
      setOffset([0, 0]);
      boostPointer.current = null;
      boostKey.current = false;
      updateBoost();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    const refresh = window.setInterval(() => {
      if (boostKey.current || boostPointer.current !== null) emit({ boost: true });
      if (stick.current !== null && direction.current !== null) emit({ direction: direction.current });
    }, 180);
    return () => {
      window.clearInterval(refresh);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
    };
    // Handlers read the latest view availability and sender from a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="lumen-controls">
    <button
      type="button" className="lumen-stick" aria-label="方向摇杆" data-snake-control=""
      disabled={!enabled}
      onPointerDown={(event) => {
        if (stick.current !== null || event.button !== 0) return;
        stick.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event);
      }}
      onPointerMove={(event) => { if (stick.current === event.pointerId) move(event); }}
      onPointerUp={releaseStick} onPointerCancel={releaseStick} onLostPointerCapture={releaseStick}
    >
      <span className="lumen-stick__knob" style={{ translate: `${offset[0]}px ${offset[1]}px` }} />
    </button>
    <button
      type="button" className="lumen-boost" aria-label="按住加速" aria-pressed={boosting && enabled}
      data-snake-control="" disabled={!enabled}
      onPointerDown={(event) => {
        if (boostPointer.current !== null || event.button !== 0) return;
        boostPointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateBoost();
      }}
      onPointerUp={releaseBoost} onPointerCancel={releaseBoost} onLostPointerCapture={releaseBoost}
    >
      <Zap size={21} aria-hidden="true" />
      <span>加速</span>
    </button>
  </div>;
}
