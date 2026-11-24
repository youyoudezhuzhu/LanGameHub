import { snakeArena } from '@park/engine';
import { useEffect, useRef } from 'react';

type View = snakeArena.ArenaView;
const { COLUMNS, ROWS, STEP_MS } = snakeArena;
export const SNAKE_COLORS = ['#75ebcc', '#a0bbff', '#ffb0be', '#ffc776', '#d4a7fb', '#91d9ff', '#d5ef86', '#ff9a76'];

function draw(canvas: HTMLCanvasElement, previous: View, current: View, amount: number) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.floor(canvas.clientWidth * ratio);
  const height = Math.floor(canvas.clientHeight * ratio);
  if (width < 1 || height < 1) return;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#0a1326';
  context.fillRect(0, 0, width, height);
  const cellSize = Math.min(width / COLUMNS, height / ROWS);
  const insetX = (width - COLUMNS * cellSize) / 2;
  const insetY = (height - ROWS * cellSize) / 2;
  context.setTransform(cellSize, 0, 0, cellSize, insetX, insetY);
  context.fillStyle = '#0d182d';
  context.fillRect(0, 0, COLUMNS, ROWS);
  context.strokeStyle = '#4b6586';
  context.lineWidth = 0.15;
  context.strokeRect(0, 0, COLUMNS, ROWS);
  context.strokeStyle = '#293f5d';
  context.lineWidth = 0.045;
  context.beginPath();
  for (let x = 2; x < COLUMNS; x += 2) {
    context.moveTo(x, 0);
    context.lineTo(x, ROWS);
  }
  for (let y = 2; y < ROWS; y += 2) {
    context.moveTo(0, y);
    context.lineTo(COLUMNS, y);
  }
  context.stroke();
  context.fillStyle = '#f7d580';
  for (const cell of current.pellets) {
    const x = (cell % COLUMNS) + 0.5;
    const y = Math.floor(cell / COLUMNS) + 0.5;
    context.beginPath();
    context.moveTo(x, y - 0.29);
    context.lineTo(x + 0.29, y);
    context.lineTo(x, y + 0.29);
    context.lineTo(x - 0.29, y);
    context.fill();
  }
  for (const [seat, snake] of current.snakes.entries()) {
    const before = previous.snakes[seat];
    const beforeCells = current.tick > previous.tick && current.tick - previous.tick <= 2
      && before?.crashes === snake.crashes ? before.cells : [];
    context.fillStyle = SNAKE_COLORS[seat % SNAKE_COLORS.length];
    for (let index = snake.cells.length - 1; index >= 0; index--) {
      const cell = snake.cells[index];
      const old = beforeCells[index] ?? cell;
      const col = cell % COLUMNS;
      const row = Math.floor(cell / COLUMNS);
      const x = old % COLUMNS + (col - old % COLUMNS) * amount;
      const y = Math.floor(old / COLUMNS) + (row - Math.floor(old / COLUMNS)) * amount;
      context.globalAlpha = index === 0 || snake.boosted ? 1 : Math.max(0.45, 0.9 - index * 0.021);
      context.beginPath();
      if (typeof context.roundRect === 'function') {
        context.roundRect(x + 0.06, y + 0.06, 0.88, 0.88, index === 0 ? 0.27 : 0.16);
      } else context.rect(x + 0.06, y + 0.06, 0.88, 0.88);
      context.fill();
      if (index === 0) {
        context.fillStyle = '#0d182d';
        context.beginPath();
        context.arc(x + 0.5, y + 0.5, 0.13, 0, 2 * Math.PI);
        context.fill();
        context.fillStyle = SNAKE_COLORS[seat % SNAKE_COLORS.length];
      }
    }
  }
  context.globalAlpha = 1;
}

export function ArenaCanvas({ view }: { view: View }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const previous = useRef(view);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const from = previous.current;
    previous.current = view;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : STEP_MS * 0.9;
    const started = performance.now();
    let frame = 0;
    const render = (now: number) => {
      const amount = duration === 0 ? 1 : Math.min(1, (now - started) / duration);
      draw(element, from, view, amount);
      if (amount < 1) frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [view]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => draw(element, previous.current, previous.current, 1));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <canvas className="lumen-canvas" ref={canvas} aria-label="流光蛇场竞技地图" />;
}
