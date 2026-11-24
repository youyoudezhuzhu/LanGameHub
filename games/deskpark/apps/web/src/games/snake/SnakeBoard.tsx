import { snakeArena } from '@park/engine';
import { Clock3, Maximize, Minimize, Trophy, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, IconButton, Sheet, toast } from '../../components/ui';
import type { GameController } from '../../lib/controller';
import { useOnline } from '../../lib/online';
import { playSound } from '../../lib/sound';
import { ArenaCanvas, SNAKE_COLORS } from './canvas';
import { SnakeControls } from './controls';
import './snake.css';

type Arena = snakeArena.ArenaView;
type Input = snakeArena.SnakeInput;
const { COUNTDOWN_TICKS, STEP_MS } = snakeArena;

export default function SnakeBoard({ ctl }: { ctl: GameController<Arena, Input> }) {
  const view = ctl.view;
  const onlineState = useOnline();
  const [dismissed, setDismissed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const arena = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onFullscreen = () => setFullscreen(
      document.fullscreenElement === arena.current?.closest('.table--arena'),
    );
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  async function toggleFullscreen() {
    const shell = arena.current?.closest<HTMLElement>('.table--arena');
    if (shell && document.fullscreenElement === shell) {
      await document.exitFullscreen().catch(() => toast('浏览器未允许退出全屏'));
      return;
    }
    if (!shell?.requestFullscreen) {
      toast('请旋转手机横屏游玩');
      return;
    }
    try {
      await shell.requestFullscreen();
      const orientation = screen.orientation as (ScreenOrientation & {
        lock?: (mode: 'landscape') => Promise<void>;
      }) | undefined;
      await orientation?.lock?.('landscape').catch(() => undefined);
      if (matchMedia('(orientation: portrait)').matches) toast('请旋转手机横屏游玩');
    } catch {
      toast('浏览器未允许全屏，请旋转手机横屏游玩');
    }
  }
  const mine = ctl.seat === null ? null : view?.snakes[ctl.seat];
  const score = mine?.score ?? 0;
  const crashes = mine?.crashes ?? 0;
  useEffect(() => { if (!ctl.over) setDismissed(false); }, [ctl.over]);
  useEffect(() => { if (score > 0) playSound('chip'); }, [score]);
  useEffect(() => { if (crashes > 0) playSound('bomb'); }, [crashes]);
  if (!view) return null;

  const starting = view.tick < COUNTDOWN_TICKS;
  const seconds = Math.ceil((view.totalTicks - Math.max(view.tick, COUNTDOWN_TICKS)) * STEP_MS / 1000);
  const mode = ctl.mode === 'online' ? onlineState.status === 'open' : true;
  const enabled = Boolean(mine?.cells.length && !ctl.over && !ctl.auto && mode);
  const name = (seat: number) => ctl.players[seat]?.name ?? `玩家 ${seat + 1}`;
  const position = ctl.seat === null ? 0 : view.ranking.indexOf(ctl.seat) + 1;

  const ranking = (summary = false) => <ol className="lumen-rank">
    {view.ranking.map((seat, rank) => (
      <li key={seat} className={seat === ctl.seat ? 'is-me' : undefined}>
        <span className="lumen-rank__position">{rank + 1}</span>
        <span style={{ background: SNAKE_COLORS[seat % SNAKE_COLORS.length] }} className="lumen-rank__swatch" />
        <span className="lumen-rank__name">{name(seat)}</span>
        <span className="lumen-rank__points">{view.snakes[seat].score} 分</span>
        {summary && <span className="lumen-rank__crashes">{view.snakes[seat].crashes} 次碰撞</span>}
      </li>
    ))}
  </ol>;

  return <div className="lumen-arena" ref={arena}>
    <section className="lumen-field" aria-label="竞技场">
      <header className="lumen-hud">
        <span><Clock3 size={16} aria-hidden="true" /> <strong data-snake-clock>{seconds}</strong> 秒</span>
        {mine && <span><Zap size={16} aria-hidden="true" /> <meter min={0} max={100} value={mine.energy} aria-label="加速能量" /></span>}
        {mine && <span><strong>{score}</strong> 分</span>}
        <IconButton label={fullscreen ? '退出全屏' : '进入全屏'} onClick={() => void toggleFullscreen()}>
          {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
        </IconButton>
      </header>
      <div className="lumen-field__canvas">
        <ArenaCanvas view={view} />
        {starting && <div className="lumen-countdown" aria-label="开局倒计时">
          {Math.ceil((COUNTDOWN_TICKS - view.tick) * STEP_MS / 1000)}
        </div>}
        {!starting && !ctl.over && mine && !mine.cells.length && (
          <span className="lumen-respawn" role="status">等待重生</span>
        )}
      </div>
    </section>
    <aside className="lumen-ranking" aria-label="实时排行榜">
      <h2><Trophy size={16} aria-hidden="true" /> 玩家排名</h2>
      {ranking()}
    </aside>
    {ctl.seat !== null && <SnakeControls enabled={enabled} send={ctl.act} />}
    {ctl.over && dismissed && (
      <div className="lumen-result"><Button onClick={() => setDismissed(false)}>本局结算</Button></div>
    )}

    <Sheet open={ctl.over && !dismissed} title="蛇场结算"
      subtitle={position ? `第 ${position} 名 · ${score} 分` : `${name(view.ranking[0])} 获胜`}
      onClose={() => setDismissed(true)}
      footer={<>
        <Button onClick={ctl.leave}>返回大厅</Button>
        {ctl.canRestart && <Button variant="primary" onClick={ctl.restart}>再来一局</Button>}
      </>}
    >
      {ranking(true)}
    </Sheet>
  </div>;
}
