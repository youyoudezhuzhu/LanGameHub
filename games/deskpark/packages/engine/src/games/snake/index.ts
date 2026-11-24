import { Rng } from '../../core/rng';
import type { GameDefinition } from '../../core/types';

export const COLUMNS = 64;
export const ROWS = 32;
export const STEP_MS = 120;
export const BOOST_COST = 12;
export const COUNTDOWN_TICKS = 25;
const CELL_COUNT = COLUMNS * ROWS;
const PELLET_COUNT = 58;
const RESPAWN_TICKS = 8;
const STARTING_LENGTH = 4;
const MAX_LENGTH = 24;
const DIRECTIONS = ['east', 'south', 'west', 'north'] as const;

export type Direction = (typeof DIRECTIONS)[number];
export interface SnakeInput {
  type: 'steer';
  direction?: Direction;
  boost?: boolean;
}
interface SnakeOptions {
  duration: number;
}

interface Snake {
  cells: number[];
  heading: Direction;
  score: number;
  crashes: number;
  energy: number;
  respawn: number;
  boosted: boolean;
}

interface Controls {
  direction?: Direction;
  boostUntil: number;
}

export interface ArenaView {
  snakes: Snake[];
  pellets: number[];
  tick: number;
  totalTicks: number;
  ranking: number[];
}

interface ArenaState extends Omit<ArenaView, 'ranking'> {
  controls: Controls[];
  rngState: number;
}

function adjacent(cell: number, direction: Direction): number | null {
  const col = cell % COLUMNS;
  const row = Math.floor(cell / COLUMNS);
  switch (direction) {
    case 'east': return col + 1 < COLUMNS ? cell + 1 : null;
    case 'south': return row + 1 < ROWS ? cell + COLUMNS : null;
    case 'west': return col > 0 ? cell - 1 : null;
    case 'north': return row > 0 ? cell - COLUMNS : null;
  }
}

function reverse(direction: Direction): Direction {
  return DIRECTIONS[(DIRECTIONS.indexOf(direction) + 2) % DIRECTIONS.length];
}

function occupiedBy(snakes: Snake[]): Set<number> {
  return new Set(snakes.flatMap((snake) => snake.cells));
}

function spawn(snake: Snake, occupied: Set<number>, pellets: Set<number>, rng: Rng): Snake {
  const initial = rng.int(CELL_COUNT);
  const headings = rng.shuffle([...DIRECTIONS]);
  for (let offset = 0; offset < CELL_COUNT; offset++) {
    const head = (initial + offset) % CELL_COUNT;
    if (occupied.has(head) || pellets.has(head)) continue;
    for (const heading of headings) {
      const ahead = adjacent(head, heading);
      if (ahead === null || occupied.has(ahead)) continue;
      const cells = [head];
      while (cells.length < STARTING_LENGTH) {
        const tail = adjacent(cells[cells.length - 1], reverse(heading));
        if (tail === null || occupied.has(tail) || pellets.has(tail)) break;
        cells.push(tail);
      }
      if (cells.length !== STARTING_LENGTH) continue;
      for (const cell of cells) occupied.add(cell);
      return { ...snake, cells, heading, respawn: 0, boosted: false, energy: 100 };
    }
  }
  // A blocked spawn retries on the following tick.
  return { ...snake, respawn: 1 };
}

function refill(snakes: Snake[], pellets: Set<number>, rng: Rng): void {
  const busy = occupiedBy(snakes);
  for (let attempts = 0; pellets.size < PELLET_COUNT && attempts < CELL_COUNT; attempts++) {
    const cell = rng.int(CELL_COUNT);
    if (!busy.has(cell)) pellets.add(cell);
  }
}

function botDirection(snake: Snake, pellets: Set<number>, occupied: Set<number>): Direction {
  const current = snake.cells[0];
  let best = snake.heading;
  let distance = Infinity;
  for (const heading of DIRECTIONS) {
    if (heading === reverse(snake.heading)) continue;
    const next = adjacent(current, heading);
    if (next === null || occupied.has(next)) continue;
    for (const pellet of pellets) {
      const steps = Math.abs(next % COLUMNS - pellet % COLUMNS)
        + Math.abs(Math.floor(next / COLUMNS) - Math.floor(pellet / COLUMNS));
      // Stay straight when two choices are equally good.
      const cost = steps + (heading === snake.heading ? 0 : 0.25);
      if (cost < distance) {
        distance = cost;
        best = heading;
      }
    }
  }
  return best;
}

/** All moves in a substep see the same board, including the tails about to move. */
function advance(snakes: Snake[], pellets: Set<number>, boostedOnly: boolean): Snake[] {
  const occupied = occupiedBy(snakes);
  const countByTarget = new Map<number, number>();
  const targets = snakes.map((snake) => {
    if (!snake.cells.length || (boostedOnly && !snake.boosted)) return undefined;
    const target = adjacent(snake.cells[0], snake.heading);
    if (target !== null) countByTarget.set(target, (countByTarget.get(target) ?? 0) + 1);
    return target;
  });
  return snakes.map((snake, index) => {
    const next = targets[index];
    if (next === undefined) return snake;
    if (next === null || occupied.has(next) || (countByTarget.get(next) ?? 0) > 1) {
      return { ...snake, cells: [], crashes: snake.crashes + 1, respawn: RESPAWN_TICKS, boosted: false };
    }
    const grew = pellets.delete(next);
    const length = Math.min(MAX_LENGTH, snake.cells.length + Number(grew));
    return { ...snake, cells: [next, ...snake.cells.slice(0, length - 1)], score: snake.score + Number(grew) };
  });
}

function step(state: ArenaState, automated: readonly boolean[]): ArenaState {
  if (state.tick < COUNTDOWN_TICKS) return { ...state, tick: state.tick + 1 };
  const rng = new Rng(state.rngState);
  const pellets = new Set(state.pellets);
  const occupied = occupiedBy(state.snakes);
  const tick = state.tick + 1;
  const ready = state.snakes.map((snake, seat) => {
    if (!snake.cells.length) return snake.respawn > 1
      ? { ...snake, respawn: snake.respawn - 1 }
      : spawn(snake, occupied, pellets, rng);
    const control = state.controls[seat];
    const heading = automated[seat]
      ? botDirection(snake, pellets, occupied)
      : control.direction ?? snake.heading;
    const boosted = !automated[seat] && control.boostUntil >= tick && snake.energy >= BOOST_COST;
    const energy = boosted ? snake.energy - BOOST_COST : Math.min(100, snake.energy + 3);
    return { ...snake, heading, energy, boosted };
  });
  const moved = advance(ready, pellets, false);
  const snakes = moved.some((snake) => snake.boosted) ? advance(moved, pellets, true) : moved;
  refill(snakes, pellets, rng);
  return {
    ...state, snakes, pellets: [...pellets], tick, rngState: rng.state,
    controls: state.controls.map(({ boostUntil }, seat) => ({
      boostUntil: !state.snakes[seat].cells.length || automated[seat] ? 0 : boostUntil,
    })),
  };
}

function ranking(snakes: Snake[]): number[] {
  return snakes.map((_, index) => index)
    .sort((a, b) => snakes[b].score - snakes[a].score || snakes[a].crashes - snakes[b].crashes);
}

export const snake: GameDefinition<ArenaState, SnakeInput, ArenaView, SnakeOptions> = {
  meta: {
    id: 'snake',
    name: '流光蛇场',
    nameEn: 'Lumen Arena',
    category: 'arcade',
    tagline: '争夺光粒，留出转弯空间，在倒计时结束前冲上榜首。',
    minPlayers: 2,
    maxPlayers: 8,
    defaultPlayers: 4,
    rules: [
      '摇杆、方向键或 WASD 控制移动。蛇只能直走或转弯。',
      '每颗光粒得一分。撞边界、蛇身或与对手抢同一格都会撞毁，短暂等待后重生。',
      '按住加速按钮或空格消耗能量，每步多走一格。松开后自动恢复能量。',
      '倒计时结束后按得分排名，同分时碰撞次数较少者靠前。',
    ],
  },
  defaultOptions: { duration: 60 },
  optionFields: [{
    key: 'duration', label: '回合时长', type: 'select',
    choices: [{ value: 30, label: '30 秒' }, { value: 60, label: '60 秒' }, { value: 90, label: '90 秒' }],
  }],
  setup({ players, options, seed }) {
    const rng = new Rng(seed);
    const occupied = new Set<number>();
    const pellets = new Set<number>();
    const snakes = players.map(() => spawn({
      cells: [], heading: 'east', score: 0, crashes: 0, respawn: 0, energy: 100, boosted: false,
    }, occupied, pellets, rng));
    refill(snakes, pellets, rng);
    return {
      snakes, pellets: [...pellets], tick: 0, totalTicks: COUNTDOWN_TICKS + (options.duration * 1000) / STEP_MS,
      controls: players.map(() => ({ boostUntil: 0 })), rngState: rng.state,
    };
  },
  activeSeats: (state) => state.snakes.flatMap((snake, seat) => snake.cells.length ? [seat] : []),
  validate(state, seat, action) {
    if (action.type !== 'steer') return '无效的蛇场操作';
    if (action.direction !== undefined && !DIRECTIONS.includes(action.direction)) return '无效的移动方向';
    if (action.boost !== undefined && typeof action.boost !== 'boolean') return '无效的加速输入';
    if (action.direction === undefined && action.boost === undefined) return '缺少控制输入';
    if (!state.snakes[seat]?.cells.length) return '等待重生';
    return null;
  },
  apply(state, seat, action) {
    const controls = [...state.controls];
    controls[seat] = { ...controls[seat] };
    if (action.direction && action.direction !== reverse(state.snakes[seat].heading)) {
      controls[seat].direction = action.direction;
    }
    if (action.boost !== undefined) controls[seat].boostUntil = action.boost ? state.tick + 5 : 0;
    return { ...state, controls };
  },
  view: ({ snakes, pellets, tick, totalTicks }) => ({
    snakes, pellets, tick, totalTicks, ranking: ranking(snakes),
  }),
  isOver: (state) => state.tick >= state.totalTicks,
  bot(view, seat) {
    const player = view.snakes[seat];
    return {
      type: 'steer', boost: false,
      direction: player?.cells.length
        ? botDirection(player, new Set(view.pellets), occupiedBy(view.snakes))
        : undefined,
    };
  },
  realtime: { stepMs: STEP_MS, step },
};
