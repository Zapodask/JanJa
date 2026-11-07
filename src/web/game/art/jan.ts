import { Grid } from './grid'
import type { Sprite } from './palette'
import { POSES } from '../../ui/pixelData'

/** Jan carteador 24x24. A base vem do Jan original (pixelData); só mudamos braços, olhos e o que ele segura. */
const STAND: Sprite = POSES.idle.frames[0]
const B = '.'.repeat(24)
const squash = (f: Sprite): Sprite => [B, ...f.slice(0, 14), ...f.slice(15)]
const shiftX = (f: Sprite, dx: number): Sprite =>
  f.map((l) => (dx > 0 ? '.'.repeat(dx) + l.slice(0, 24 - dx) : l.slice(-dx) + '.'.repeat(-dx)))

function make(patches: [number, number, Sprite][], base: Sprite = STAND): Sprite {
  const g = Grid.from(base)
  for (const [x, y, p] of patches) g.put(x, y, p)
  return g.toSprite()
}

/** Mãos nas pontas do baralho (6 de largura, colunas 9..14). */
const HANDS_UP: [number, number, Sprite][] = [
  [7, 18, ['O']],
  [16, 18, ['O']],
  [8, 16, ['s']],
  [15, 16, ['s']]
]

/** Janela 6x4 do baralho, linhas 14..17, colunas 9..14. */
const deck = (win: string[]): [number, number, Sprite] => [9, 14, win]

const RIFFLE: string[][] = [
  ['      ', 'kkkkkk', 'ppPPpp', 'kkkkkk'],
  ['k    k', 'pkkkkp', 'kppppk', ' kkkk '],
  [' kkkk ', 'kppppk', 'kpkkpk', 'kk  kk'],
  ['kkkkkk', 'kppppk', 'kk  kk', 'k    k'],
  ['      ', ' kkkk ', 'kppppk', ' kkkk '],
  ['      ', 'kkkkkk', 'ppPPpp', 'kkkkkk']
]
const hold = (i: number): Sprite => make([...HANDS_UP, deck(RIFFLE[i])])

export const JAN_SHUFFLE: Sprite[] = [hold(0), hold(1), squash(hold(2)), hold(3), squash(hold(4)), hold(5)]
export const JAN_IDLE: Sprite[] = [hold(0), squash(hold(0))]

const HAND: Sprite = ['kkkk', 'kssk', 'kssk', 'kkkk']
/** Braço direito esticado: manga em 3 linhas e mão de 4x4. */
const armOut = (hx: number): [number, number, Sprite][] => [
  [16, 15, ['kkkkk'.slice(0, hx - 16)]],
  [16, 16, ['ooooo'.slice(0, hx - 16)]],
  [16, 17, ['kkkkk'.slice(0, hx - 16)]],
  [hx, 14, HAND],
  [8, 16, ['s']],
  [7, 18, ['O']]
]

// ---------- deal: braço direito estica e solta a carta ----------
const CARD_IN_AIR: Sprite = ['kkkk', 'kppk', 'kPpk', 'kkkk']
export const JAN_DEAL: Sprite[] = [
  hold(0),
  make([...armOut(19), deck(['      ', '      ', 'kkkkkk', 'ppPPpp'])]),
  make([...armOut(20), deck(['      ', '      ', 'kkkkkk', 'ppPPpp']), [20, 9, CARD_IN_AIR]])
]

// ---------- clap: palmas na frente do peito ----------
const clapOpen: [number, number, Sprite][] = [
  [7, 14, HAND],
  [13, 14, HAND]
]
const clapTogether: [number, number, Sprite][] = [
  [9, 14, ['kkkkkk', 'kssssk', 'kssssk', 'kkkkkk']],
  [4, 14, ['y']], [3, 16, ['y']], [19, 14, ['y']], [20, 16, ['y']], [5, 12, ['y']], [18, 12, ['y']]
]
export const JAN_CLAP: Sprite[] = [make(clapOpen), squash(make(clapTogether)), make(clapOpen), squash(make(clapTogether))]

// ---------- scared: braços para cima, olhos arregalados, gota de suor ----------
const scaredFace: [number, number, Sprite][] = [
  [8, 9, ['ppp']],
  [8, 10, ['pkp']],
  [13, 9, ['ppp']],
  [13, 10, ['pkp']],
  [11, 11, ['kk']],
  [11, 12, ['kk']]
]
const ARM_L: Sprite = ['kkk ', 'ksk ', 'ksk ', 'kok ', 'kok ', 'kok ', 'kok ', 'kooo', 'kook']
const flipRow = (l: string) => [...l].reverse().join('')
const scaredArms: [number, number, Sprite][] = [
  [2, 3, ARM_L],
  [18, 3, ARM_L.map(flipRow)]
]
const scaredBase = make(scaredFace)
export const JAN_SCARED: Sprite[] = [
  make([...scaredArms, [21, 8, ['c', 'c']]], scaredBase),
  shiftX(make([...scaredArms, [20, 7, ['c', 'c']]], squash(scaredBase)), 1)
]

// ---------- give: entrega ficha ou troféu ----------
const CHIP_ITEM: Sprite = ['.kkk.', 'kyyYk', 'kYYYk', '.kkk.']
const TROPHY_ITEM: Sprite = ['kykkyk', 'kyyyyk', '.kyyk.', '..kk..', '.kmmk.']
export const JAN_GIVE: Sprite[] = [
  make([...HANDS_UP, [10, 14, ['kkkk', 'kyyk', 'kYYk', 'kkkk']]]),
  make([...armOut(18), [18, 10, CHIP_ITEM]]),
  make([...armOut(19), [19, 10, CHIP_ITEM]])
]
export const JAN_GIVE_TROPHY: Sprite[] = [
  make([...HANDS_UP, [9, 14, ['..kk..', '.kyyk.', 'kykkyk', 'kyyyyk']]]),
  make([...armOut(18), [17, 9, TROPHY_ITEM]]),
  make([...armOut(19), [18, 9, TROPHY_ITEM]])
]
