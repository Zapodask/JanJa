/** Mapa do espaço livre da Home e caminhos do Jan (lógica pura, testável). */


export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Grid {
  cols: number
  rows: number
  cell: number
  free: Uint8Array // 1 = o Jan cabe com o canto superior esquerdo nesta célula
}

const hits = (a: Box, b: Box): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/** Marca as células onde o Jan (size×size) cabe sem encostar em nenhum obstáculo. */
export function buildGrid(width: number, height: number, size: number, obstacles: Box[]): Grid {
  const cell = Math.max(12, Math.round(size / 3))
  const cols = Math.max(0, Math.floor((width - size) / cell) + 1)
  const rows = Math.max(0, Math.floor((height - size) / cell) + 1)
  const free = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const box = { x: c * cell, y: r * cell, w: size, h: size }
      free[r * cols + c] = obstacles.some((o) => hits(box, o)) ? 0 : 1
    }
  }
  return { cols, rows, cell, free }
}

/** Caminho em 8 direções (diagonal só se as duas laterais estiverem livres). BFS: grade pequena. */
export function findPath(g: Grid, from: number, to: number): number[] | null {
  if (!g.free[from] || !g.free[to]) return null
  const prev = new Int32Array(g.free.length).fill(-1)
  prev[from] = from
  const queue = [from]
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]
    if (cur === to) break
    const r = Math.floor(cur / g.cols)
    const c = cur % g.cols
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue
        const nr = r + dr
        const nc = c + dc
        if (nr < 0 || nc < 0 || nr >= g.rows || nc >= g.cols) continue
        const n = nr * g.cols + nc
        if (!g.free[n] || prev[n] !== -1) continue
        if (dr && dc && (!g.free[r * g.cols + nc] || !g.free[nr * g.cols + c])) continue
        prev[n] = cur
        queue.push(n)
      }
    }
  }
  if (prev[to] === -1) return null
  const path = [to]
  while (path[path.length - 1] !== from) path.push(prev[path[path.length - 1]])
  return path.reverse()
}

/** Células livres alcançáveis a partir de `from` (o Jan não "atravessa" conteúdo). */
export function reachable(g: Grid, from: number): number[] {
  if (!g.free[from]) return []
  const seen = new Uint8Array(g.free.length)
  seen[from] = 1
  const queue = [from]
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]
    const r = Math.floor(cur / g.cols)
    const c = cur % g.cols
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const nr = r + dr
      const nc = c + dc
      if (nr < 0 || nc < 0 || nr >= g.rows || nc >= g.cols) continue
      const n = nr * g.cols + nc
      if (g.free[n] && !seen[n]) {
        seen[n] = 1
        queue.push(n)
      }
    }
  }
  return queue
}

/** Rótulo de região conectada por célula (-1 = bloqueada). */
export function regions(g: Grid): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(g.free.length).fill(-1)
  const sizes: number[] = []
  for (let i = 0; i < g.free.length; i++) {
    if (!g.free[i] || label[i] !== -1) continue
    const id = sizes.length
    const cells = reachable(g, i)
    for (const c of cells) label[c] = id
    sizes.push(cells.length)
  }
  return { label, sizes }
}

/** Célula livre mais próxima de um ponto (px). */
export function nearestFree(g: Grid, x: number, y: number): number {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < g.free.length; i++) {
    if (!g.free[i]) continue
    const cx = (i % g.cols) * g.cell
    const cy = Math.floor(i / g.cols) * g.cell
    const d = (cx - x) ** 2 + (cy - y) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

