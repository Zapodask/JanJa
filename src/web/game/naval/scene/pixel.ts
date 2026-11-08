/**
 * Pixel art da batalha naval, gerada em código. Cada casa do mar tem 8x8 pixels.
 * Navio deitado (proa para a direita), com `size` casas de comprimento; em pé é o mesmo desenho girado.
 * Sem React: o teste importa daqui.
 */
export type Sprite = string[]
export const CELL_PX = 8

export const PAL: Record<string, string> = {
  k: '#0F0B09',
  d: '#9A9590',
  D: '#6F6A66',
  w: '#5A4A40',
  p: '#F3EBDD',
  y: '#FFC94A',
  Y: '#E0A92E',
  r: '#E05A4A',
  b: '#9CC7E0',
  B: '#6FA3C7'
}

/** casco afinando na proa, convés no meio, ponte com janela acesa */
export function shipSprite(size: number): Sprite {
  const w = size * CELL_PX
  const inside = (x: number, y: number): boolean => {
    if (y < 1 || y > 6 || x < 0 || x >= w) return false
    const r = w - 1 - x // distância da proa
    const half = r >= 6 ? 3 : r * 0.5
    return Math.abs(y + 0.5 - 4) <= half + 0.5
  }
  const rows: string[][] = Array.from({ length: CELL_PX }, (_, y) => Array.from({ length: w }, (_, x) => (inside(x, y) ? 'd' : '.')))
  for (let y = 0; y < CELL_PX; y++)
    for (let x = 0; x < w; x++) {
      if (rows[y][x] === '.') continue
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
      if (edge) rows[y][x] = 'k'
      else if (y === 5) rows[y][x] = 'D' // sombra do casco
      else if ((y === 3 || y === 4) && x >= 2 && x < w - 6) rows[y][x] = 'w' // convés
    }
  // ponte de comando no meio
  const mid = Math.floor(w / 2) - 2
  for (let y = 2; y <= 4; y++) for (let x = mid; x < mid + 4; x++) rows[y][x] = y === 2 ? 'k' : 'p'
  rows[3][mid + 1] = 'y'
  rows[3][mid + 2] = 'y'
  return rows.map((r) => r.join(''))
}

/** acerto: fogo */
export const HIT: Sprite = ['...r....', '..ryr...', '.ryyyr..', '.ryYyr..', 'ryyYYyr.', 'ryYYYyr.', '.rrrrr..', '........']
/** água: respingo */
export const MISS: Sprite = ['........', '...b....', '.b.b.b..', '..bpb...', '.bpppb..', '..bBb...', '........', '........']

export interface Run {
  x: number
  y: number
  w: number
  fill: string
}

export function runs(sprite: Sprite): Run[] {
  const out: Run[] = []
  sprite.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      if (ch === '.') {
        x++
        continue
      }
      let w = 1
      while (row[x + w] === ch) w++
      out.push({ x, y, w, fill: PAL[ch] })
      x += w
    }
  })
  return out
}
