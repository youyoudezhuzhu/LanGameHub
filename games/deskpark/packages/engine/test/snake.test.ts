import { afterEach, describe, expect, it, vi } from 'vitest';
import { Table, simulate, snake, snakeArena } from '../src';

const { COLUMNS, COUNTDOWN_TICKS, STEP_MS, BOOST_COST } = snakeArena;
const seats = [{ name: '甲', isBot: false }, { name: '乙', isBot: false }];

function arena() {
  const state = snake.setup({ players: seats, options: { duration: 30 }, seed: 40 });
  state.tick = COUNTDOWN_TICKS;
  state.pellets = [];
  return state;
}

describe('流光蛇场', () => {
  afterEach(() => vi.useRealTimers());

  it('输入频率不会延迟时钟，停止后没有残留定时器', () => {
    vi.useFakeTimers();
    const table = new Table(snake, seats, { duration: 30 }, { seed: 38 });
    table.start();
    for (let i = 0; i < 5; i++) {
      expect(table.act(0, { type: 'steer', direction: 'east' })).toBeNull();
      vi.advanceTimersByTime(STEP_MS / 5);
    }
    expect(table.version).toBe(1);
    table.dispose();
    vi.advanceTimersByTime(1000);
    expect(table.version).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('同格相撞时两名玩家都会重生，光粒状态一致', () => {
    const state = arena();
    const y = 10 * COLUMNS;
    state.snakes[0] = { ...state.snakes[0], heading: 'east', cells: [y + 14, y + 13, y + 12] };
    state.snakes[1] = { ...state.snakes[1], heading: 'west', cells: [y + 16, y + 17, y + 18] };
    const next = snake.realtime!.step(state, [false, false]);
    expect(next.snakes.map(({ cells, crashes }) => ({ cells, crashes }))).toEqual([
      { cells: [], crashes: 1 }, { cells: [], crashes: 1 },
    ]);
    let respawned = next;
    for (let i = 0; i < 8; i++) respawned = snake.realtime!.step(respawned, [false, false]);
    expect(respawned.snakes.every((player) => player.cells.length > 0)).toBe(true);
    expect(state.snakes[0].cells[0]).toBe(y + 14);
  });

  it('加速移动两格、消耗能量，允许转弯且拒绝掉头与伪造系统动作', () => {
    const state = arena();
    const y = 10 * COLUMNS;
    state.snakes[0] = { ...state.snakes[0], heading: 'east', cells: [y + 14, y + 13, y + 12] };
    state.snakes[1] = { ...state.snakes[1], heading: 'east', cells: [y + 30, y + 29, y + 28] };
    state.pellets = [y + 15, y + 16];
    let input = snake.apply(state, 0, { type: 'steer', direction: 'west', boost: true });
    expect(input.controls[0].direction).toBeUndefined();
    input = snake.realtime!.step(input, [false, false]);
    expect(input.snakes[0]).toMatchObject({ heading: 'east', score: 2, energy: 100 - BOOST_COST, boosted: true });
    expect(input.snakes[0].cells[0]).toBe(y + 16);
    const turned = snake.realtime!.step(snake.apply(input, 0, { type: 'steer', direction: 'north', boost: false }), [false, false]);
    expect(turned.snakes[0].cells[0]).toBe(y + 16 - COLUMNS);
    const table = new Table(snake, seats, { duration: 30 }, { manual: true, initialState: input });
    expect(table.act(0, { type: 'tick' })).not.toBeNull();
    expect(table.act(0, { type: 'steer', boost: 'yes' })).not.toBeNull();
  });

  it('八个电脑座位的模拟可复现，并按时生成排名', () => {
    const a = simulate(snake, 8, { duration: 30 }, 52);
    const b = simulate(snake, 8, { duration: 30 }, 52);
    expect(a).toEqual(b);
    expect(snake.isOver(a.state)).toBe(true);
    expect(a.steps).toBe(COUNTDOWN_TICKS + 250);
    expect(snake.view(a.state, null).ranking).toHaveLength(8);
    expect(a.state.snakes.some(({ score }) => score > 0)).toBe(true);
  });
});
