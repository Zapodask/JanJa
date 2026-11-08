/**
 * Pixel art do Magnata, desenhada em código (uma letra por cor). Sem React: o teste importa daqui.
 * Cores fixas por letra; 'c' é a cor do jogador (troca em cada peão).
 */
export type Sprite = string[]

export const PAL: Record<string, string> = {
  k: '#0F0B09',
  p: '#F3EBDD',
  d: '#B7A99A',
  y: '#FFC94A',
  Y: '#E0A92E',
  r: '#E05A4A',
  b: '#6FA3C7',
  B: '#3F6F94',
  g: '#6FD49B',
  w: '#3B312C'
}

/**
 * Cor de cada jogador pela ordem de jogo. Aqui a cor diz de quem é cada cidade, então precisa ser
 * diferente para todo mundo (o tom da sala vem do nome e pode repetir).
 */
export const PLAYER_COLORS = ['#FFC94A', '#6FA3C7', '#E05A4A', '#6FD49B', '#B98BE0', '#F08A3C']

/** peão do jogador */
export const PAWN: Sprite = [
  '...kkkk...',
  '..kcchck..',
  '..kccccck.',
  '..kccccck.',
  '...kcccck.',
  '....kcck..',
  '...kcccck.',
  '..kcccccck',
  '.kccccccck',
  '.kkkkkkkkk'
].map((r) => r.padEnd(10, '.'))

/** casa (nível 1 a 3) e hotel (nível 4) */
export const HOUSE: Sprite = ['..k..', '.kgk.', 'kgggk', 'kgkgk', 'kkkkk']
export const HOTEL: Sprite = ['kkkkkkk', 'krrrrrk', 'krprprk', 'krrrrrk', 'krprprk', 'kkkkkkk']

/** dado: face de 1 a 6 numa grade 9x9 */
const PIPS: Record<number, Array<[number, number]>> = {
  1: [[4, 4]],
  2: [[2, 2], [6, 6]],
  3: [[2, 2], [4, 4], [6, 6]],
  4: [[2, 2], [6, 2], [2, 6], [6, 6]],
  5: [[2, 2], [6, 2], [4, 4], [2, 6], [6, 6]],
  6: [[2, 2], [6, 2], [2, 4], [6, 4], [2, 6], [6, 6]]
}
export function dieFace(n: number): Sprite {
  const g: string[][] = Array.from({ length: 9 }, (_, y) =>
    Array.from({ length: 9 }, (_, x) => (x === 0 || y === 0 || x === 8 || y === 8 ? 'k' : x === 7 || y === 7 ? 'd' : 'p'))
  )
  for (const [x, y] of PIPS[n] ?? []) g[y][x] = 'k'
  // cantos arredondados
  for (const [x, y] of [[0, 0], [8, 0], [0, 8], [8, 8]]) g[y][x] = '.'
  return g.map((r) => r.join(''))
}

/** ícones das casas especiais (9x9) */
export const ICONS: Record<'start' | 'jam' | 'festival' | 'airport' | 'beach' | 'surprise' | 'tax', Sprite> = {
  start: ['....k....', '...kyk...', '..kyyyk..', '.kyyyyyk.', 'kkkyyykkk', '...kyk...', '...kyk...', '...kyk...', '...kkk...'],
  jam: ['.........', '..kkkkk..', '.krrrrrk.', 'krpkrkprk', 'krrrrrrrk', 'kkkkkkkkk', '.kk...kk.', '.kk...kk.', '.........'],
  festival: ['k........', 'kyy......', 'kyyyy....', 'kyyyyyy..', 'kyyyy....', 'kyy......', 'k........', 'k........', 'k........'],
  airport: ['....k....', '...kbk...', '...kbk...', '.kkbbbkk.', 'kbbbbbbbk', '.kkbbbkk.', '...kbk...', '..kbbbk..', '..kkkkk..'],
  beach: ['.........', '..kyyk...', '.kyyyyk..', '..kyyk...', '.........', 'kb..kb..k', 'bBkbBkbBk', 'BBBBBBBBB', '.........'],
  surprise: ['..kkkkk..', '.kyyyyyk.', '.kyk.kyk.', '....kyyk.', '...kyyk..', '...kyk...', '...kkk...', '...kyk...', '...kkk...'],
  tax: ['.kkkkkkk.', '.kpppppk.', '.kpkpkpk.', '.kpppppk.', '.kpkkkpk.', '.kpppppk.', '.kpkpkpk.', '.kpppppk.', '.kkkkkkk.']
}

export interface Run {
  x: number
  y: number
  w: number
  fill: string
}

/** pixels iguais e vizinhos na mesma linha viram uma tira (menos <rect>) */
export function runs(sprite: Sprite, color = '#FFC94A'): Run[] {
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
      out.push({ x, y, w, fill: ch === 'c' ? color : ch === 'h' ? '#FFFFFF' : PAL[ch] })
      x += w
    }
  })
  return out
}
