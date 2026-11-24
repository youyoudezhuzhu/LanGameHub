import { Flag, RotateCcw, Undo2 } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Seat } from '../../components/Seat';
import { Button, Sheet } from '../../components/ui';
import type { GameController } from '../../lib/controller';
import { usePortrait, useSeatScale } from '../../lib/media';
import { playSound } from '../../lib/sound';
import { useCompact } from './trick';
import './duel.css';

/**
 * 双人棋类的通用布局：棋盘 + 右侧栏（对手、着法、操作、自己）。
 * 棋盘的大小只取决于可用空间和固定宽度的侧栏，不会和内容互相影响。
 *
 * 竖屏手机放不下「棋盘 + 侧栏」的横排，所以窄竖屏改成上下堆叠：
 * 棋盘占上方（按可用宽高求出最大边长），侧栏落到下方、自己可滚。
 * 横屏 / 平板 / 桌面仍然是原来的横排，`compact`（矮屏）分支行为不变。
 */

function useBox() {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    const update = () =>
      setBox((b) =>
        b.w === el.clientWidth && b.h === el.clientHeight
          ? b
          : { w: el.clientWidth, h: el.clientHeight },
      );
    ro.current = new ResizeObserver(update);
    ro.current.observe(el);
    update();
  }, []);
  return [ref, box] as const;
}

export function DuelLayout({
  aspect,
  board,
  side,
  sideFoot,
  className = '',
}: {
  /** 棋盘宽高比 */
  aspect: number;
  board: ReactNode;
  side: ReactNode;
  /** 侧栏底部固定区（操作按钮、自己的信息卡），竖屏堆叠时不会被滚动区藏起来 */
  sideFoot?: ReactNode;
  className?: string;
}) {
  const portrait = usePortrait();
  const compact = useCompact();
  const k = useSeatScale();
  const [ref, box] = useBox();
  const sideW = compact ? 230 : Math.round(Math.min(340, Math.max(270, box.w * 0.24)) * k);
  const gap = compact ? 10 : 22;
  // 横排时留给棋盘的总宽度
  const rowRoom = box.w - sideW - gap;
  // 竖屏且横排放不下像样的棋盘（窄手机）→ 上下堆叠；
  // 平板竖屏（768px 起）横排仍然够用，保持原样；横屏永远不会进这个分支
  const stack = portrait && box.w > 0 && (compact || rowRoom < 300);

  // 横排（原逻辑，不能退化）
  const rowH = Math.max(0, Math.min(box.h, rowRoom / aspect));
  const rowW = Math.floor(rowH * aspect);

  // 堆叠：侧栏至少留出能看见对手卡 + 按钮的高度，剩下全给棋盘
  const stackGap = 10;
  const sideMin = Math.max(170, Math.min(420, Math.round(box.h * 0.42)));
  const stackW = Math.floor(Math.min(box.w, Math.max(0, box.h - stackGap - sideMin) * aspect));
  const stackH = stackW / aspect;
  const stackSideH = Math.max(0, box.h - stackH - stackGap);

  return (
    <div className={`duel ${className}`} style={{ '--k': k } as CSSProperties}>
      <div className="duel__arena" ref={ref}>
        {box.w > 0 &&
          (stack ? (
            <div className="duel__stack" style={{ gap: stackGap }}>
              <div className="duel__board" style={{ width: stackW }}>
                {board}
              </div>
              <div className="duel__side duel__side--stack" style={{ height: stackSideH }}>
                <div className="duel__scroll">{side}</div>
                {sideFoot && <div className="duel__foot">{sideFoot}</div>}
              </div>
            </div>
          ) : (
            <div className="duel__row" style={{ gap }}>
              <div className="duel__board" style={{ width: rowW }}>
                {board}
              </div>
              <aside
                className="duel__side"
                style={{ width: sideW, height: Math.max(rowH, compact ? 0 : 420) }}
              >
                {side}
                {sideFoot}
              </aside>
            </div>
          ))}
      </div>
    </div>
  );
}

export function PlayerCard({
  ctl,
  seat,
  badge,
  active,
  captured,
  note,
}: {
  ctl: GameController;
  seat: number;
  /** 执子颜色的小标记 */
  badge: ReactNode;
  active: boolean;
  /** 吃掉的对方棋子 */
  captured?: ReactNode;
  note?: ReactNode;
}) {
  const compact = useCompact();
  return (
    <div className={`duel-card ${active ? 'is-turn' : ''}`}>
      <div className="duel-card__head">
        <Seat
          player={ctl.players[seat]}
          active={active}
          deadline={ctl.deadlines[seat]}
          size={compact ? 30 : 40}
          layout="row"
          figureOverflow
          sub={<span className="duel-card__badge">{badge}</span>}
        />
        {note && <span className="duel-card__note">{note}</span>}
      </div>
      {captured && <div className="duel-card__captured">{captured}</div>}
    </div>
  );
}

/** 着法记录：每行一个回合（先手、后手） */
export function MoveList({ moves, numbered = true }: { moves: string[]; numbered?: boolean }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [moves.length]);
  const rows: [string, string | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i], moves[i + 1]]);
  return (
    <ol className="duel-moves" ref={ref}>
      {rows.length === 0 && <li className="duel-moves__empty">还没有着法</li>}
      {rows.map(([a, b], i) => {
        const lastRow = i === rows.length - 1;
        return (
          <li key={i}>
            {numbered && <span className="duel-moves__no num">{i + 1}.</span>}
            <span className={lastRow && !b ? 'is-last' : ''}>{a}</span>
            <span className={lastRow && b ? 'is-last' : ''}>{b ?? ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function DuelActions({
  canUndo,
  showUndo,
  canResign,
  onUndo,
  onResign,
  onFlip,
}: {
  canUndo: boolean;
  showUndo: boolean;
  canResign: boolean;
  onUndo: () => void;
  onResign: () => void;
  onFlip: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="duel-actions">
      {showUndo && (
        <Button
          size="sm"
          variant="felt"
          disabled={!canUndo}
          onClick={onUndo}
          title="撤回自己上一步和电脑的应着"
        >
          <Undo2 size={14} /> 悔棋
        </Button>
      )}
      <Button size="sm" variant="felt" onClick={onFlip} title="翻转棋盘">
        <RotateCcw size={14} /> 翻转
      </Button>
      <Button size="sm" variant="felt" disabled={!canResign} onClick={() => setConfirm(true)}>
        <Flag size={14} /> 认输
      </Button>
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="确定认输吗？"
        subtitle="认输后本局立即结束"
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>再想想</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirm(false);
                onResign();
              }}
            >
              认输
            </Button>
          </>
        }
      />
    </div>
  );
}

export function DuelResult({
  ctl,
  open,
  onClose,
  won,
  title,
  sub,
}: {
  ctl: GameController;
  open: boolean;
  onClose: () => void;
  won: boolean | null;
  title: string;
  sub: string;
}) {
  useEffect(() => {
    if (open && won !== null) playSound(won ? 'win' : 'lose');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>查看棋局</Button>
          <Button onClick={() => ctl.leave()}>返回大厅</Button>
          {ctl.canRestart && (
            <Button variant="primary" onClick={() => ctl.restart()}>
              再来一局
            </Button>
          )}
        </>
      }
    >
      <div className="result">
        <div className={`result__title ${won ? 'is-win' : 'is-lose'}`}>{title}</div>
        <div className="result__sub">{sub}</div>
      </div>
    </Sheet>
  );
}
