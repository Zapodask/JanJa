import { Grid } from './grid'
import { TINY } from './glyphs'
import type { Sprite } from './palette'

export const CHIP_W = 12
export const CHIP_H = 12

interface ChipStyle {
  /** cor base, sombra e listras da borda */
  a: string
  A: string
  S: string
  /** brilho no alto à esquerda */
  hl: string
}
export const CHIP_COLORS: Record<string, ChipStyle> = {
  amber: { a: 'y', A: 'Y', S: 'p', hl: 'p' },
  coral: { a: 'o', A: 'O', S: 'p', hl: 'p' },
  green: { a: 'g', A: 'G', S: 'p', hl: 'p' },
  cream: { a: 'p', A: 'd', S: 'o', hl: 'p' }
}

/** Disco visto de cima, 12x10. */
const FACE = [
  '...kkkkkk...',
  '..kaaSSaak..',
  '.kaaaaaaaak.',
  'kSaaAAAAaaSk',
  'kaaAaaaaAaak',
  'kaaAaaaaAaak',
  'kSaaAAAAaaSk',
  '.kaaaaaaaak.',
  '..kaaSSaak..',
  '...kkkkkk...'
]

/** Ficha 12x12: face + 2 px de espessura (borda A e contorno k). */
export function chip(style: ChipStyle, face: Sprite = FACE, letters?: Sprite): Sprite {
  const g = new Grid(CHIP_W, CHIP_H)
  const sub = (c: string) => (c === 'a' ? style.a : c === 'A' ? style.A : c === 'S' ? style.S : c)
  const top = face.map((l) => [...l].map(sub).join(''))
  const solid = (x: number, y: number) => top[y]?.[x] !== undefined && top[y][x] !== '.'
  // espessura: silhueta deslocada 1 e 2 px para baixo
  for (let y = 0; y < CHIP_H; y++)
    for (let x = 0; x < CHIP_W; x++) {
      if (solid(x, y)) continue
      if (solid(x, y - 1)) g.set(x, y, style.A)
      else if (solid(x, y - 2)) g.set(x, y, 'k')
    }
  g.put(0, 0, top)
  if (face === FACE) g.set(2, 2, style.hl)
  if (letters) {
    const lx = Math.floor((CHIP_W - letters[0].length) / 2)
    g.stamp(lx, 3, letters, 'k')
  }
  return g.toSprite()
}

export function chipSprite(color: keyof typeof CHIP_COLORS): Sprite {
  return chip(CHIP_COLORS[color])
}

/** Pilha: n fichas, cada uma 2 px acima da anterior (a borda de cada ficha aparece). */
export function chipStack(color: keyof typeof CHIP_COLORS, n: number): Sprite {
  const st = CHIP_COLORS[color]
  const top = chipSprite(color)
  const side = chip({ a: st.A, A: st.A, S: st.A, hl: st.A })
  const g = new Grid(CHIP_W, CHIP_H + 2 * (n - 1))
  for (let i = 0; i < n; i++) g.blit(0, 2 * (n - 1 - i), i === n - 1 ? top : side)
  return g.toSprite()
}

/** Face lisa (sem listras internas) para botões com letra. */
const BTN_FACE = [
  '...kkkkkk...',
  '..kaaaaaak..',
  '.kaaaaaaaak.',
  'kaaaaaaaaaak',
  'kaaaaaaaaaak',
  'kaaaaaaaaaak',
  'kaaaaaaaaaak',
  '.kaaaaaaaak.',
  '..kaaaaaak..',
  '...kkkkkk...'
]
const word = (t: string): Sprite => {
  const rows = ['', '', '', '', '']
  ;[...t].forEach((ch, i) => TINY[ch].forEach((l, r) => (rows[r] += (i ? '.' : '') + l)))
  return rows
}
const button = (a: string, A: string, text: string): Sprite => {
  const s = chip({ a, A, S: a, hl: 'p' }, BTN_FACE, word(text))
  const g = Grid.from(s)
  g.set(2, 2, 'p')
  return g.toSprite()
}
export const dealerButton = (): Sprite => button('p', 'd', 'D')
export const smallBlind = (): Sprite => button('c', 'c', 'SB')
export const bigBlind = (): Sprite => button('o', 'O', 'BB')
