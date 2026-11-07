import type { Sprite } from './palette'

/** Tela de pixels mutável para compor sprites. `.` = transparente. */
export class Grid {
  readonly cells: string[][]
  constructor(
    readonly w: number,
    readonly h: number,
    fill = '.'
  ) {
    this.cells = Array.from({ length: h }, () => Array<string>(w).fill(fill))
  }
  static from(s: Sprite): Grid {
    const g = new Grid(s[0].length, s.length)
    s.forEach((line, y) => [...line].forEach((ch, x) => (g.cells[y][x] = ch)))
    return g
  }
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h
  }
  get(x: number, y: number): string {
    return this.inside(x, y) ? this.cells[y][x] : '.'
  }
  set(x: number, y: number, ch: string): this {
    if (this.inside(x, y)) this.cells[y][x] = ch
    return this
  }
  rect(x: number, y: number, w: number, h: number, ch: string): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, ch)
    return this
  }
  /** Escreve um patch (espaço = não mexe, `.` = apaga). */
  put(x: number, y: number, patch: Sprite): this {
    patch.forEach((line, j) => [...line].forEach((ch, i) => ch !== ' ' && this.set(x + i, y + j, ch)))
    return this
  }
  /** Como `put`, mas `.` deixa o fundo como está. */
  blit(x: number, y: number, s: Sprite): this {
    s.forEach((line, j) => [...line].forEach((ch, i) => ch !== '.' && ch !== ' ' && this.set(x + i, y + j, ch)))
    return this
  }
  /** Máscara ('#') pintada com uma cor. */
  stamp(x: number, y: number, mask: Sprite, ch: string): this {
    mask.forEach((line, j) => [...line].forEach((c, i) => c === '#' && this.set(x + i, y + j, ch)))
    return this
  }
  replace(from: string, to: string): this {
    for (const row of this.cells) for (let i = 0; i < row.length; i++) if (row[i] === from) row[i] = to
    return this
  }
  toSprite(): Sprite {
    return this.cells.map((r) => r.join(''))
  }
}

export const flipV = (s: Sprite): Sprite => [...s].reverse()
export const flipH = (s: Sprite): Sprite => s.map((l) => [...l].reverse().join(''))
export const rot180 = (s: Sprite): Sprite => flipV(flipH(s))
export const recolor = (s: Sprite, map: Record<string, string>): Sprite =>
  s.map((l) => [...l].map((c) => map[c] ?? c).join(''))

/** Matriz de Bayer 4x4 (0..15) para dithering ordenado. */
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
]
/** Limiar de Bayer em 0..1 */
export const bayer = (x: number, y: number): number => (BAYER4[y & 3][x & 3] + 0.5) / 16
