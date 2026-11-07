import { Grid } from './grid'
import { DIGIT_1, RANK_GLYPHS } from './glyphs'
import type { Sprite } from './palette'

const digit = (n: number): Sprite => (n === 1 ? DIGIT_1 : RANK_GLYPHS[String(n)])
const big = (s: Sprite): Sprite =>
  s.flatMap((l) => {
    const w = [...l].map((c) => c + c).join('')
    return [w, w]
  })

/** Degrau 32 x h: tampo claro (luz de cima), frente em tábuas e número em relevo. */
export function podiumStep(place: 1 | 2 | 3): Sprite {
  const h = place === 1 ? 36 : place === 2 ? 28 : 20
  const g = new Grid(32, h)
  g.rect(0, 0, 32, h, 'k')
  g.rect(1, 1, 30, 4, 'M') // tampo
  g.rect(1, 1, 30, 1, 'p')
  g.rect(1, 5, 30, 1, 'm') // quina
  g.rect(1, 6, 30, h - 7, 'm')
  for (let x = 1; x < 31; x++) for (let y = 6; y < h - 1; y++) if ((x - 1) % 10 === 9) g.set(x, y, 'n')
  g.rect(1, 6, 1, h - 7, 'M') // quina esquerda iluminada
  g.rect(30, 6, 1, h - 7, 'n')
  g.rect(1, h - 2, 30, 1, 'n')
  // número
  const col = place === 1 ? 'y' : place === 2 ? 'p' : 'o'
  const sh = place === 1 ? 'Y' : place === 2 ? 'd' : 'O'
  const gl = big(digit(place))
  const gx = (32 - gl[0].length) >> 1
  const gy = 6 + ((h - 8 - gl.length) >> 1)
  g.stamp(gx, gy + 1, gl.map((l) => l.replace(/[^#]/g, '.')), sh)
  g.stamp(gx, gy, gl.map((l) => l.replace(/[^#]/g, '.')), col)
  // pregos
  g.set(3, h - 4, 'k').set(28, h - 4, 'k')
  return g.toSprite()
}

/** Pódio montado: 2º, 1º e 3º lado a lado (96 x 36, alinhados embaixo). */
export function podium(): Sprite {
  const g = new Grid(96, 36)
  g.blit(0, 36 - 28, podiumStep(2))
  g.blit(32, 0, podiumStep(1))
  g.blit(64, 36 - 20, podiumStep(3))
  return g.toSprite()
}

export function trophy(): Sprite {
  const t = [
    '..kkkkkkkkkkkk..',
    'kkkpyyyyyyyyYkkk',
    'kykpyyyyyyyyYkyk',
    'kykpyyppyyyyYkyk',
    '.kkpyyypyyyyYkk.',
    '..kpyyyyyyyyYk..',
    '...kpyyyyyyYk...',
    '....kpyyyyYk....',
    '.....kkYYkk.....',
    '......kYYk......',
    '......kyYk......',
    '.....kkYYkk.....',
    '....kmmmmmmk....',
    '...kMmmmmmmmk...',
    '...knnnnnnnnk...',
    '...kkkkkkkkkk...'
  ]
  return t
}

/** Confete 2x2 em 5 cores. */
export const CONFETTI: Record<string, Sprite> = {
  amber: ['yy', 'YY'],
  coral: ['oo', 'OO'],
  green: ['gg', 'GG'],
  cream: ['pp', 'PP'],
  sky: ['cc', 'cc']
}
