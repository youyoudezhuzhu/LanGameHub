import type { AnyGame, GameCategory } from '@park/engine';
import { getGame } from '@park/engine';
import { normalizeRoomCode } from '@park/protocol';
import { ArrowRight, Gamepad2, Play, Radio, Settings2, Users } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { PlayingCard } from '../components/PlayingCard';
import { MahjongTile } from '../components/MahjongTile';
import { Avatar } from '../components/Seat';
import { Button, IconButton } from '../components/ui';
import type { GameUI } from '../games';
import { GAME_UIS } from '../games';
import { clearSavedLocal, loadSavedLocal } from '../lib/controller';
import { online, useOnline } from '../lib/online';
import { navigate } from '../lib/router';
import { profile } from '../lib/store';
import { markFreshStart } from './LocalGame';
import { SettingsSheet } from './SettingsSheet';
import { SetupSheet } from './SetupSheet';
import './home.css';

const CATEGORIES: { id: GameCategory; title: string }[] = [
  { id: 'poker', title: '扑克' },
  { id: 'mahjong', title: '麻将' },
  { id: 'chess', title: '棋类' },
  { id: 'board', title: '桌游' },
];

function GameArt({ ui }: { ui: GameUI }) {
  if (ui.Art) {
    return (
      <div
        className="gtile__art"
        style={{ '--t1': ui.tint[0], '--t2': ui.tint[1] } as CSSProperties}
      >
        <ui.Art />
      </div>
    );
  }
  if (ui.tiles) {
    return (
      <div
        className="gtile__art"
        style={{ '--t1': ui.tint[0], '--t2': ui.tint[1] } as CSSProperties}
      >
        <div className="gtile__tiles">
          {ui.tiles.map((t, i) => (
            <MahjongTile
              key={t.id}
              tile={t}
              w="clamp(34px, 7vw, 46px)"
              style={{ '--i': i - 1 } as CSSProperties}
            />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="gtile__art" style={{ '--t1': ui.tint[0], '--t2': ui.tint[1] } as CSSProperties}>
      <div className="gtile__fan">
        {ui.showcase.map((c, i) => (
          <PlayingCard
            key={c.id}
            card={c}
            w="clamp(40px, 9vw, 58px)"
            wild={ui.wildIds?.includes(c.id)}
            style={{ '--i': i - (ui.showcase.length - 1) / 2 } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

function GameTile({
  ui,
  def,
  onPick,
}: {
  ui: GameUI;
  def: AnyGame;
  onPick: (mode: 'local' | 'online') => void;
}) {
  return (
    <article className="gtile">
      <GameArt ui={ui} />
      <div className="gtile__body">
        <div className="gtile__head">
          <h3>{def.meta.name}</h3>
          <span className="gtile__people">
            <Users size={13} /> {ui.people}
          </span>
        </div>
        <p className="gtile__tagline">{def.meta.tagline}</p>
        <div className="gtile__actions">
          <Button variant="primary" size="sm" onClick={() => onPick('local')}>
            <Play size={14} /> 单人
          </Button>
          <Button size="sm" onClick={() => onPick('online')}>
            <Users size={14} /> 联机
          </Button>
        </div>
      </div>
      {ui.badge && <span className="gtile__badge">{ui.badge}</span>}
    </article>
  );
}

export function Home() {
  const p = profile.use();
  const net = useOnline();
  const [setup, setSetup] = useState<{ gameId: string; mode: 'local' | 'online' } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [code, setCode] = useState('');
  const [category, setCategory] = useState<GameCategory | 'all'>('all');
  const [counts, setCounts] = useState<{ clients: number; rooms: number } | null>(null);
  useEffect(() => {
    online.connect();
    const controller = new AbortController();
    const update = () => {
      void fetch('/api/status', { signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((value) => setCounts(value))
        .catch(() => { if (!controller.signal.aborted) setCounts(null); });
    };
    update();
    const interval = window.setInterval(update, 4000);
    return () => { clearInterval(interval); controller.abort(); };
  }, []);
  const resume = GAME_UIS.map((g) => (loadSavedLocal(g.id) ? g.id : null)).find(Boolean) ?? null;
  const resumeDef = resume ? getGame(resume) : null;

  const join = () => {
    const c = normalizeRoomCode(code);
    if (c.length === 4) navigate(`/room/${c}`);
  };

  const groups = CATEGORIES.map((c) => ({
    ...c,
    games: GAME_UIS.filter((g) => getGame(g.id)?.meta.category === c.id),
  }));
  const visible = groups.filter((group) => category === 'all' || group.id === category);
  const tile = (ui: GameUI) => (
    <GameTile
      key={ui.id}
      ui={ui}
      def={getGame(ui.id)!}
      onPick={(mode) => setSetup({ gameId: ui.id, mode })}
    />
  );

  return (
    <div className="home">
      <header className="home__top">
        <div className="brand">
          <span className="hub-mark"><Gamepad2 size={22} /></span>
          <span className="brand__text">
            <strong>LAN Game Hub</strong>
            <small>局域网游戏大厅</small>
          </span>
        </div>
        <div className="home__me">
          <button className="me-chip" onClick={() => setSettingsOpen(true)} aria-label="修改昵称">
            <Avatar name={p.name} avatar={p.avatar} size={28} />
            <span>{p.name}</span>
          </button>
          <IconButton label="设置" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={19} />
          </IconButton>
        </div>
      </header>

      <section className="hero">
        <div className="hero__content">
          <span className="hub-status">
            <Radio size={15} />
            {counts ? `${counts.clients} 人在线 · ${counts.rooms} 个房间` : '正在连接主机'}
          </span>
          <h1>同一个局域网，<br />来一局。</h1>
          <p>选个游戏开桌，或用好友的房间码直接加入。</p>
          <form className="join" onSubmit={(event) => { event.preventDefault(); join(); }}>
            <input
              value={code}
              onChange={(event) => setCode(normalizeRoomCode(event.target.value))}
              placeholder="输入 4 位房间号"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-label="房间号"
            />
            <Button variant="primary" type="submit" disabled={code.length !== 4}>
              加入房间 <ArrowRight size={15} />
            </Button>
          </form>
        </div>
        <div className="hero__art" aria-hidden="true">
          <div className="hero__orbit" />
          <span className="hero__card hero__card--rear">♜</span>
          <span className="hero__card hero__card--front">♠</span>
          <span className="hero__tile">發</span>
        </div>
      </section>

      {net.room && (
        <section className="resume">
          <div>
            <strong>你在房间 {net.room.code} 中</strong>
            <span>
              {getGame(net.room.gameId)?.meta.name} ·{' '}
              {net.room.status === 'playing' ? '对局进行中' : '等待开局'}
            </span>
          </div>
          <div className="resume__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                online.send({ t: 'leave' });
              }}
            >
              离开
            </Button>
            <Button variant="primary" size="sm" onClick={() => navigate(`/room/${net.room!.code}`)}>
              回到房间
            </Button>
          </div>
        </section>
      )}

      {resume && resumeDef && (
        <section className="resume">
          <div>
            <strong>继续上次的{resumeDef.meta.name}</strong>
            <span>单人对局已自动保存</span>
          </div>
          <div className="resume__actions">
            <Button variant="ghost" size="sm" onClick={() => clearSavedLocal()}>
              放弃
            </Button>
            <Button variant="primary" size="sm" onClick={() => navigate(`/play/${resume}`)}>
              继续
            </Button>
          </div>
        </section>
      )}

      <div className="hub-library">
        <div><h2>游戏库</h2><p>{groups.reduce((count, group) => count + group.games.length, 0)} 款桌游</p></div>
        <div className="hub-filters" role="group" aria-label="游戏分类">
          {[{ id: 'all' as const, title: '全部' }, ...CATEGORIES].map((item) => (
            <button key={item.id} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>
              {item.title}
            </button>
          ))}
        </div>
      </div>
      {visible.map((group) => (
        <section className="games-group" key={group.id}>
          <h2>{group.title}</h2>
          <div className="games">{group.games.map(tile)}</div>
        </section>
      ))}

      <footer className="home__foot">
        <span>LAN Game Hub</span><span>桌游引擎由 DeskPark 提供</span>
      </footer>

      {setup && (
        <SetupSheet
          gameId={setup.gameId}
          mode={setup.mode}
          onClose={() => setSetup(null)}
          onStart={() => {
            if (setup.mode === 'local') {
              markFreshStart();
              navigate(`/play/${setup.gameId}`);
            } else {
              navigate('/room/new');
            }
          }}
        />
      )}
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} showProfile />
    </div>
  );
}
