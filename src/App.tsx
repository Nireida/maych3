import React, { useState, useEffect, useRef, useReducer } from 'react';
import { Application, extend, useTick } from '@pixi/react';
import { Container, Graphics } from 'pixi.js';

// Регистрируем pixi-классы как JSX-элементы (<pixiContainer>, <pixiGraphics>)
extend({ Container, Graphics });

// --- НАСТРОЙКИ ---
const GRID_SIZE = 12;
const TILE_SIZE = 40;
const BOARD_SIZE = GRID_SIZE * TILE_SIZE;
const COLORS = [0xFF4B4B, 0x4BC5FF, 0x4BFF4B, 0xFFD84B];
const SWAP_SPEED = 6;   // пикселей за тик при свопе
const SCALE_SPEED = 0.08; // как быстро шарик ужимается при исчезновении (за тик)

interface Tile {
  id: string;
  colorIndex: number;
}
type Cell = Tile | null;

// Создать новый тайл со случайным цветом.
function makeTile(r: number, c: number): Tile {
  return {
    id: `t-${r}-${c}-${Date.now()}-${Math.random()}`,
    colorIndex: Math.floor(Math.random() * COLORS.length),
  };
}

// Применить «гравитацию» по каждому столбцу: существующие тайлы сдвигаются
// вниз, заполняя пустоты, а сверху досыпаются новые шарики.
// initPositions/initScales заполняем для новых тайлов сразу — стартовая Y
// выше доски, чтобы анимация выглядела как падение сверху.
function applyGravityAndRefill(
  grid: Cell[][],
  initPositions: Map<string, { x: number; y: number }>,
  initScales: Map<string, number>,
): Cell[][] {
  const newGrid: Cell[][] = grid.map((row) => row.slice());

  for (let c = 0; c < GRID_SIZE; c++) {
    // Собираем существующие тайлы в столбце (сверху вниз).
    const remaining: Tile[] = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      const cell = newGrid[r][c];
      if (cell) remaining.push(cell);
    }
    const missing = GRID_SIZE - remaining.length;

    // Верхние missing клеток — новые тайлы.
    for (let r = 0; r < missing; r++) {
      const tile = makeTile(r, c);
      newGrid[r][c] = tile;
      // Стартовая позиция — над доской, чтобы тайл «падал» в свою клетку.
      initPositions.set(tile.id, {
        x: c * TILE_SIZE,
        y: (r - missing) * TILE_SIZE,
      });
      initScales.set(tile.id, 1);
    }
    // Снизу — оставшиеся, в исходном порядке.
    for (let i = 0; i < remaining.length; i++) {
      newGrid[missing + i][c] = remaining[i];
    }
  }

  return newGrid;
}

// Поиск всех горизонтальных и вертикальных серий длиной >= 3 одного цвета.
// Возвращает множество id тайлов, попавших в матч.
function findMatches(grid: Cell[][]): Set<string> {
  const matchedIds = new Set<string>();

  // Горизонтальные серии
  for (let r = 0; r < GRID_SIZE; r++) {
    let c = 0;
    while (c < GRID_SIZE) {
      const t = grid[r][c];
      if (!t) { c++; continue; }
      let end = c + 1;
      while (
        end < GRID_SIZE &&
        grid[r][end] &&
        grid[r][end]!.colorIndex === t.colorIndex
      ) end++;
      if (end - c >= 3) for (let k = c; k < end; k++) matchedIds.add(grid[r][k]!.id);
      c = end;
    }
  }

  // Вертикальные серии
  for (let c = 0; c < GRID_SIZE; c++) {
    let r = 0;
    while (r < GRID_SIZE) {
      const t = grid[r][c];
      if (!t) { r++; continue; }
      let end = r + 1;
      while (
        end < GRID_SIZE &&
        grid[end][c] &&
        grid[end][c]!.colorIndex === t.colorIndex
      ) end++;
      if (end - r >= 3) for (let k = r; k < end; k++) matchedIds.add(grid[k][c]!.id);
      r = end;
    }
  }

  return matchedIds;
}

function Board() {
  const [grid, setGrid] = useState<Cell[][]>([]);
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);

  // Зеркало grid для чтения внутри useTick (где state замораживается в замыкании).
  const gridRef = useRef<Cell[][]>(grid);
  useEffect(() => { gridRef.current = grid; }, [grid]);

  // Текущие отрисованные позиции тайлов (id -> {x, y}).
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Целевые позиции (пересчитываются из grid).
  const targetsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Масштабы тайлов (1 = норм, 0 = удалён). Анимируется на удалении.
  const scalesRef = useRef<Map<string, number>>(new Map());
  // Кто сейчас исчезает.
  const exitingRef = useRef<Set<string>>(new Set());
  // Идёт ли какая-либо анимация — на это время клики блокируем.
  const isAnimatingRef = useRef(false);
  // Нужно ли после остановки анимации проверить доску на матчи.
  const pendingMatchCheckRef = useRef(false);
  // Для форс-ререндера на тиках движения.
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  // Инициализация поля
  useEffect(() => {
    const newGrid: Cell[][] = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      newGrid[r] = [];
      for (let c = 0; c < GRID_SIZE; c++) {
        newGrid[r][c] = {
          id: `${r}-${c}-${Math.random()}`,
          colorIndex: Math.floor(Math.random() * COLORS.length),
        };
      }
    }
    setGrid(newGrid);
  }, []);

  // Пересчёт целевых позиций + инициализация refs для новых тайлов.
  // Любая смена grid = потенциальная смена позиций мячиков, поэтому
  // ставим флаг "после остановки анимации надо проверить матчи".
  useEffect(() => {
    const targets = new Map<string, { x: number; y: number }>();
    grid.forEach((row, r) =>
      row.forEach((tile, c) => {
        if (!tile) return;
        const target = { x: c * TILE_SIZE, y: r * TILE_SIZE };
        targets.set(tile.id, target);
        if (!positionsRef.current.has(tile.id)) {
          positionsRef.current.set(tile.id, { ...target });
        }
        if (!scalesRef.current.has(tile.id)) {
          scalesRef.current.set(tile.id, 1);
        }
      }),
    );
    targetsRef.current = targets;
    pendingMatchCheckRef.current = true;
  }, [grid]);

  // Найти матчи на текущей доске и пометить их как "исчезающие".
  const processMatches = () => {
    const matched = findMatches(gridRef.current);
    if (matched.size === 0) return;
    matched.forEach((id) => exitingRef.current.add(id));
    isAnimatingRef.current = true;
    forceRender();
  };

  // Главный тик: движение + усадка + удаление + триггер проверки матчей.
  useTick((ticker: any) => {
    const delta = typeof ticker?.deltaTime === 'number' ? ticker.deltaTime : 1;
    const moveStep = SWAP_SPEED * delta;
    const scaleStep = SCALE_SPEED * delta;

    const targets = targetsRef.current;
    const positions = positionsRef.current;
    const scales = scalesRef.current;
    let moving = false;

    // 1) Двигаем позиции к целевым
    positions.forEach((pos, id) => {
      const t = targets.get(id);
      if (!t) return;
      const dx = t.x - pos.x;
      const dy = t.y - pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= moveStep) {
        pos.x = t.x;
        pos.y = t.y;
      } else {
        moving = true;
        pos.x += (dx / dist) * moveStep;
        pos.y += (dy / dist) * moveStep;
      }
    });

    // 2) Ужимаем исчезающие
    const exitFinishedIds: string[] = [];
    exitingRef.current.forEach((id) => {
      const s = (scales.get(id) ?? 1) - scaleStep;
      if (s <= 0) {
        scales.set(id, 0);
        exitFinishedIds.push(id);
      } else {
        scales.set(id, s);
        moving = true;
      }
    });

    // 3) Удаляем "доисчезавшие" из grid и из refs, затем применяем
    //    гравитацию и досыпаем новые шарики сверху.
    if (exitFinishedIds.length > 0) {
      const finishedSet = new Set(exitFinishedIds);
      const clearedGrid = gridRef.current.map((row) =>
        row.map((cell) => (cell && finishedSet.has(cell.id) ? null : cell)),
      );
      exitFinishedIds.forEach((id) => {
        exitingRef.current.delete(id);
        scales.delete(id);
        positions.delete(id);
        targets.delete(id);
      });
      const newGrid = applyGravityAndRefill(clearedGrid, positions, scales);
      gridRef.current = newGrid;
      setGrid(newGrid);
    }

    if (moving || isAnimatingRef.current) {
      isAnimatingRef.current = moving;
      forceRender();
    }

    // Анимации закончились — самое время проверить матчи (например, после свопа)
    if (!isAnimatingRef.current && pendingMatchCheckRef.current) {
      pendingMatchCheckRef.current = false;
      processMatches();
    }
  });

  // Обработка клика по шарику
  const handleTileClick = (r: number, c: number) => {
    if (isAnimatingRef.current) return;
    const tile = grid[r]?.[c];
    if (!tile) return; // по пустой клетке не реагируем

    if (!selected) {
      setSelected({ r, c });
      return;
    }

    const isNeighbor = Math.abs(selected.r - r) + Math.abs(selected.c - c) === 1;

    if (isNeighbor) {
      const nextGrid = grid.map((row) => [...row]);
      const temp = nextGrid[selected.r][selected.c];
      nextGrid[selected.r][selected.c] = nextGrid[r][c];
      nextGrid[r][c] = temp;

      // Своп разрешён только если он создаёт хотя бы одну тройку в строке или столбце.
      // Иначе шарики остаются на местах.
      if (findMatches(nextGrid).size > 0) {
        setGrid(nextGrid);
        isAnimatingRef.current = true;
        // pendingMatchCheck выставит useEffect(grid)
      }
    }
    setSelected(null);
  };

  return (
    <pixiContainer>
      {grid.map((row, r) =>
        row.map((tile, c) => {
          if (!tile) return null;
          const isSelected = selected && selected.r === r && selected.c === c;
          const pos = positionsRef.current.get(tile.id) ?? { x: c * TILE_SIZE, y: r * TILE_SIZE };
          const scale = scalesRef.current.get(tile.id) ?? 1;

          // Контейнер ставим в центр клетки и применяем scale — тогда шарик
          // ужимается из центра, а не из левого верхнего угла.
          return (
            <pixiContainer
              key={tile.id}
              x={pos.x + TILE_SIZE / 2}
              y={pos.y + TILE_SIZE / 2}
              scale={scale}
            >
              <pixiGraphics
                draw={(g: Graphics) => {
                  g.clear();
                  // Интерактивная зона (невидимый квадрат для отлова кликов)
                  g.rect(-TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
                  g.fill({ color: 0x000000, alpha: 0 });

                  // Сам шарик
                  g.circle(0, 0, TILE_SIZE * 0.4);
                  g.fill({ color: COLORS[tile.colorIndex] });

                  // Обводка, если выбран
                  if (isSelected) {
                    g.circle(0, 0, TILE_SIZE * 0.45);
                    g.stroke({ width: 2, color: 0xffffff });
                  }
                }}
                eventMode="static"
                onPointerDown={() => handleTileClick(r, c)}
              />
            </pixiContainer>
          );
        }),
      )}
    </pixiContainer>
  );
}

// Отступ от краёв экрана, чтобы поле не упиралось в самые границы вьюпорта.
const VIEWPORT_PADDING = 16;

function useBoardScale() {
  const getScale = () => {
    if (typeof window === 'undefined') return 1;
    const available = Math.min(window.innerWidth, window.innerHeight) - VIEWPORT_PADDING * 2;
    return Math.min(1, available / BOARD_SIZE);
  };

  const [scale, setScale] = useState<number>(getScale);

  useEffect(() => {
    const onResize = () => setScale(getScale());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return scale;
}

export default function App() {
  const scale = useBoardScale();
  const size = BOARD_SIZE * scale;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        backgroundColor: '#1a1a1a',
      }}
    >
      <Application
        width={size}
        height={size}
        background={0x2a2a2a}
        antialias
      >
        <pixiContainer scale={scale}>
          <Board />
        </pixiContainer>
      </Application>
    </div>
  );
}
