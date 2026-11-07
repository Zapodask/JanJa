import { Grid, flipV, rot180 } from './grid'
import { RANK_GLYPHS, SUIT_BIG, SUIT_SMALL } from './glyphs'
import type { Sprite } from './palette'
import { TV_FRAMES } from '../../ui/pixelData'

export const CARD_W = 32
export const CARD_H = 48
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const
export const SUITS = ['c', 'd', 'h', 's'] as const
export type Suit = (typeof SUITS)[number]
const isRed = (s: string) => s === 'h' || s === 'd'

/** Casca da carta: contorno k com cantos arredondados, papel p, sombra P embaixo e à direita. */
function cardShell(): Grid {
  const g = new Grid(CARD_W, CARD_H)
  g.rect(0, 0, CARD_W, CARD_H, 'k')
  g.rect(1, 1, CARD_W - 2, CARD_H - 2, 'p')
  // sombra do papel (luz vem de cima): última coluna e última linha
  g.rect(1, CARD_H - 2, CARD_W - 2, 1, 'P')
  g.rect(CARD_W - 2, 1, 1, CARD_H - 2, 'P')
  // cantos arredondados (raio 3)
  for (const [x, y] of [[0, 0], [1, 0], [0, 1]]) {
    g.set(x, y, '.')
    g.set(CARD_W - 1 - x, y, '.')
    g.set(x, CARD_H - 1 - y, '.')
    g.set(CARD_W - 1 - x, CARD_H - 1 - y, '.')
  }
  for (const [x, y] of [[2, 1], [1, 2]]) {
    g.set(x, y, 'k')
    g.set(CARD_W - 1 - x, y, 'k')
    g.set(x, CARD_H - 1 - y, 'k')
    g.set(CARD_W - 1 - x, CARD_H - 1 - y, 'k')
  }
  // brilho do papel nos cantos de cima
  g.set(2, 2, 'p').set(CARD_W - 3, 2, 'p')
  return g
}

/** Naipe grande 13x13: contorno + preenchimento + luz em cima + sombra embaixo. */
export function bigSuit(suit: string): Sprite {
  const mask = SUIT_BIG[suit]
  const red = isRed(suit)
  const g = new Grid(13, 13)
  const m = (x: number, y: number) => mask[y]?.[x] === '#'
  for (let y = -1; y <= 11; y++)
    for (let x = -1; x <= 11; x++) {
      if (m(x, y)) continue
      let near = false
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m(x + dx, y + dy)) near = true
      if (near) g.set(x + 1, y + 1, red ? 'R' : 'k')
    }
  for (let y = 0; y < 11; y++)
    for (let x = 0; x < 11; x++) {
      if (!m(x, y)) continue
      const lit = (!m(x - 1, y) || !m(x, y - 1)) && x + y <= 9
      const shade = (!m(x + 1, y) || !m(x, y + 1)) && x + y >= 11
      let ch = red ? 'o' : 'k'
      if (lit) ch = red ? 'p' : 'r'
      else if (shade) ch = red ? 'O' : 'k'
      g.set(x + 1, y + 1, ch)
    }
  return g.toSprite()
}

const smallSuit = (suit: string): Sprite => {
  const c = isRed(suit) ? 'R' : 'k'
  return SUIT_SMALL[suit].map((l) => l.replace(/#/g, c))
}

const glyph = (rank: string, ch: string): Sprite => RANK_GLYPHS[rank].map((l) => l.replace(/#/g, ch))

function scale2(s: Sprite): Sprite {
  return s.flatMap((l) => {
    const w = [...l].map((c) => c + c).join('')
    return [w, w]
  })
}

/** Bloco do canto: valor em cima, naipe pequeno embaixo (7 de largura). */
function indexBlock(rank: string, suit: string): Sprite {
  const col = isRed(suit) ? 'R' : 'k'
  const r = glyph(rank, col)
  const g = new Grid(7, 15)
  g.blit(Math.floor((7 - r[0].length) / 2), 0, r)
  g.blit(0, 8, smallSuit(suit))
  return g.toSprite()
}

// ---------- retratos J / Q / K (12x29, metade de cima espelhada) ----------
// a/A = roupa clara/escura (muda com o naipe), y/Y coroa, n cabelo, s/S pele, p barba, o boca
const HALF: Record<string, Sprite> = {
  K: [
    '..y.yy.y..',
    '..yyyyyy..',
    '..YYYYYY..',
    '.nssssssn.',
    '.nskssksn.',
    '.nspppps..',
    '..pppppp..',
    '.apppppAa.',
    'aaApppAaaa',
    'aAaAAAAaAa',
    'aayaaaayaa',
    'aaayaayaaa',
    'aaaaaaaaaa'
  ],
  Q: [
    '..y.yy.y..',
    '..yyyyyy..',
    '.nYYYYYYn.',
    'nnssssssnn',
    'nnskssksnn',
    'nnssssssnn',
    'nnssooss.n',
    '.n.SssS.n.',
    'nnaayyaann',
    'naaayyaaan',
    'aaaAyyAaaa',
    'aaayaayaaa',
    'aaaaaaaaaa'
  ],
  J: [
    '..AAAAAA.y',
    '.AaaaaaAyy',
    '.AAAAAAA..',
    '.nssssssn.',
    '.nskssksn.',
    '.nssssssn.',
    '..ssoos...',
    '...SssS...',
    '.aaaaaaaa.',
    'aaAaaaaAaa',
    'aayAaaAyaa',
    'aaayaayaaa',
    'aaaaaaaaaa'
  ]
}

function portrait(rank: string, suit: string): Sprite {
  const half = HALF[rank]
  const [a, A] = isRed(suit) ? ['o', 'O'] : ['h', 'f']
  const sub = (s: Sprite) => s.map((l) => [...l].map((c) => (c === 'a' ? a : c === 'A' ? A : c)).join(''))
  const top = sub(half).map((l, i) => (i >= 7 ? l[0] + l + l[l.length - 1] : '.' + l + '.'))
  const w = 14
  const h = 2 * top.length + 1 + 2
  const g = new Grid(w, h, 'k')
  g.rect(1, 1, w - 2, h - 2, 'c')
  g.blit(1, 1, top)
  g.blit(1, 1 + top.length + 1, flipV(top))
  g.rect(1, 1 + top.length, w - 2, 1, 'k')
  return g.toSprite()
}

export function cardFace(rank: string, suit: Suit): Sprite {
  const g = cardShell()
  const idx = indexBlock(rank, suit)
  g.blit(2, 3, idx)
  // canto de baixo: o valor gira 180 graus, o naipe fica em pé (coração de cabeça para baixo parece espadas)
  const rk = rot180(glyph(rank, isRed(suit) ? 'R' : 'k'))
  g.blit(CARD_W - 2 - 7, CARD_H - 3 - 15, new Grid(7, 15).blit(0, 0, smallSuit(suit)).blit((7 - rk[0].length) >> 1, 8, rk).toSprite())
  const col = isRed(suit) ? 'R' : 'k'
  if (rank === 'J' || rank === 'Q' || rank === 'K') {
    const p = portrait(rank, suit)
    g.put((CARD_W - p[0].length) >> 1, ((CARD_H - p.length) >> 1) + 1, p)
  } else {
    // valor grande no centro (2x) com sombra + naipe grande
    const big = scale2(glyph(rank, col))
    const bx = (CARD_W - big[0].length) >> 1
    g.blit(bx + 1, 8 + 1, big.map((l) => l.replace(new RegExp(col, 'g'), 'P')))
    g.blit(bx, 8, big)
    const s = bigSuit(suit)
    g.blit((CARD_W - 13) >> 1, 26, s)
  }
  return g.toSprite()
}

// ---------- verso: xadrez-dither café com a TV do JanJa ----------
export function cardBack(): Sprite {
  const g = new Grid(CARD_W, CARD_H)
  const shell = cardShell()
  g.put(0, 0, shell.toSprite())
  // moldura creme + linha escura
  for (let y = 1; y < CARD_H - 1; y++)
    for (let x = 1; x < CARD_W - 1; x++) {
      const d = Math.min(x, y, CARD_W - 1 - x, CARD_H - 1 - y)
      if (d === 3) g.set(x, y, 'k')
      else if (d >= 4) {
        const lat = (x + y) % 4 === 0 || (x - y + 64) % 4 === 0
        const dot = (x + y) % 4 === 0 && (x - y + 64) % 4 === 0
        g.set(x, y, dot ? 'M' : lat ? 'n' : 'm')
      }
    }
  // medalhão central
  const mx = 4
  const my = 9
  const mw = 24
  const mh = 30
  g.rect(mx, my, mw, mh, 'k')
  g.rect(mx + 1, my + 1, mw - 2, mh - 2, 'P')
  for (let y = my + 1; y < my + mh - 1; y++) for (let x = mx + 1; x < mx + mw - 1; x++) if ((x + y) % 2 === 0 && y < my + 4) g.set(x, y, 'p')
  for (const [x, y] of [[mx, my], [mx + mw - 1, my], [mx, my + mh - 1], [mx + mw - 1, my + mh - 1]]) g.set(x, y, 'M')
  // TV do JanJa (recorte 20x21 do quadro "ligada")
  const tv = TV_FRAMES[4].slice(1, 22).map((l) => l.slice(2, 22))
  g.blit(mx + 2, my + 4, tv)
  return g.toSprite()
}

/** Espaço vazio da carta (tracejado) para marcar onde uma carta vai cair. */
export function cardSlot(): Sprite {
  const g = new Grid(CARD_W, CARD_H)
  const shell = cardShell().toSprite()
  shell.forEach((l, y) =>
    [...l].forEach((c, x) => {
      if (c !== 'k') return
      const along = x === 0 || x === CARD_W - 1 ? y : x
      if (Math.floor(along / 2) % 2 === 0) g.set(x, y, 'h')
    })
  )
  return g.toSprite()
}

/** Destaque: contorno externo vira amarelo e o anel de papel logo abaixo vira ouro. */
export function highlight(s: Sprite): Sprite {
  const g = Grid.from(s)
  const out = Grid.from(s)
  const edge = (x: number, y: number) =>
    g.get(x, y) !== '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.get(x + dx, y + dy) === '.')
  const ring: [number, number][] = []
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (edge(x, y)) ring.push([x, y])
  ring.forEach(([x, y]) => out.set(x, y, 'y'))
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      if (g.get(x, y) === '.' || edge(x, y)) continue
      const touch = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => edge(x + dx, y + dy))
      if (touch && 'pPm'.includes(g.get(x, y))) out.set(x, y, 'Y')
    }
  return out.toSprite()
}

/** Verso pequeno 16x24 (cartas fechadas dos outros jogadores). */
export function cardMiniBack(): Sprite {
  const W = 16
  const H = 24
  const g = new Grid(W, H)
  g.rect(0, 0, W, H, 'k')
  g.rect(1, 1, W - 2, H - 2, 'p')
  g.rect(1, H - 2, W - 2, 1, 'P').rect(W - 2, 1, 1, H - 2, 'P')
  for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) g.set(x, y, '.')
  for (let y = 3; y < H - 3; y++)
    for (let x = 3; x < W - 3; x++) {
      const lat = (x + y) % 4 === 0 || (x - y + 64) % 4 === 0
      g.set(x, y, lat ? 'n' : 'm')
    }
  // TV do JanJa no centro
  g.rect(4, 8, 8, 8, 'k').rect(5, 9, 6, 6, 'P')
  g.rect(5, 10, 4, 3, 'y').rect(5, 12, 4, 1, 'Y').rect(10, 10, 1, 3, 'b')
  g.set(6, 7, 'k').set(9, 7, 'k')
  return g.toSprite()
}
