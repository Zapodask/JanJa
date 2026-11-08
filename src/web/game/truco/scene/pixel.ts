/**
 * Naipes do baralho espanhol em pixel art (9x9), desenhados em código. Sem React: o teste importa daqui.
 */
import type { Suit } from '../../../../shared/games/truco/cards'

export type Sprite = string[]

export const PAL: Record<string, string> = {
  k: '#0F0B09',
  p: '#F3EBDD',
  d: '#B7A99A',
  y: '#FFC94A',
  Y: '#E0A92E',
  r: '#E05A4A',
  R: '#A83A2E',
  g: '#9C6B4E',
  G: '#6E4A36',
  b: '#6FA3C7',
  B: '#3F6F94'
}

export const SUIT_SPRITES: Record<Suit, Sprite> = {
  // espada: lâmina, guarda dourada e cabo
  e: ['....k....', '...kbk...', '...kbk...', '...kBk...', '...kbk...', '.kkkykkk.', '.kyyyyyk.', '...kGk...', '....k....'],
  // paus (basto): clava de madeira
  b: ['...kkk...', '..kgggk..', '..kgGgk..', '...kgk...', '...kGk...', '...kgk...', '..kgggk..', '..kgGgk..', '...kkk...'],
  // ouro: moeda
  o: ['..kkkkk..', '.kyyyyyk.', 'kyyYYYyyk', 'kyYyyyYyk', 'kyYyyyYyk', 'kyYyyyYyk', 'kyyYYYyyk', '.kyyyyyk.', '..kkkkk..'],
  // copa: taça
  c: ['.kkkkkkk.', '.krrrrrk.', '.krRrrrk.', '..krrrk..', '...krk...', '...kRk...', '..kkrkk..', '.krrrrrk.', '.kkkkkkk.']
}

/** cor do número em cada naipe */
export const SUIT_INK: Record<Suit, string> = { e: '#3F6F94', b: '#6E4A36', o: '#E0A92E', c: '#A83A2E' }

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
