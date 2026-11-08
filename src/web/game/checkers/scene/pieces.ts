/**
 * Peças das damas em pixel art, geradas em código: um disco visto de cima e de lado (16x16),
 * com friso no meio; a dama ganha uma coroa cor de abajur. Sem React (o teste importa daqui).
 * k = contorno, f = tampo, h = brilho, g = friso, s = lateral, y/Y = coroa.
 */
export const DISC_SIZE = 16

const CROWN = ['y.yy.y', 'yyyyyy', 'YYYYYY']

function build(king: boolean): string[] {
  const n = DISC_SIZE
  const cx = 8
  const cy = 6.5
  const rx = 6.4
  const ry = 4.4
  const depth = 3
  const d = (x: number, y: number) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2
  const g: string[][] = Array.from({ length: n }, () => new Array<string>(n).fill('.'))
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const t = d(x, y)
      if (t <= 1) g[y][x] = t >= 0.4 && t <= 0.62 ? 'g' : t > 0.62 && x + 0.5 < cx && y + 0.5 < cy ? 'h' : 'f'
      else if (Array.from({ length: depth }, (_, k) => d(x, y - k - 1) <= 1).some(Boolean)) g[y][x] = 's'
    }
  }
  if (king) CROWN.forEach((row, i) => [...row].forEach((ch, j) => ch !== '.' && (g[5 + i][5 + j] = ch)))
  // contorno: casa vazia vizinha de casa pintada
  const filled = (x: number, y: number) => y >= 0 && y < n && x >= 0 && x < n && g[y][x] !== '.' && g[y][x] !== 'k'
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (g[y][x] === '.' && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) g[y][x] = 'k'
  return g.map((r) => r.join(''))
}

export const DISCS = { man: build(false), king: build(true) }

export const DISC_PALETTE: Record<'w' | 'b', Record<string, string>> = {
  w: { k: '#0F0B09', f: '#F3EBDD', h: '#FFFFFF', g: '#D2C4B0', s: '#B7A99A', y: '#FFC94A', Y: '#E0A92E' },
  b: { k: '#0F0B09', f: '#3B312C', h: '#6E5A4E', g: '#2E2622', s: '#221C19', y: '#FFC94A', Y: '#E0A92E' }
}

export interface PixelRun {
  x: number
  y: number
  w: number
  fill: string
}

/** Peça (letra w/b/W/B) em tiras de pixels iguais. */
export function discRuns(piece: string): PixelRun[] {
  const pal = DISC_PALETTE[piece.toLowerCase() === 'w' ? 'w' : 'b']
  const rows = piece === 'W' || piece === 'B' ? DISCS.king : DISCS.man
  const out: PixelRun[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      if (ch === '.') {
        x++
        continue
      }
      let w = 1
      while (row[x + w] === ch) w++
      out.push({ x, y, w, fill: pal[ch] })
      x += w
    }
  })
  return out
}
