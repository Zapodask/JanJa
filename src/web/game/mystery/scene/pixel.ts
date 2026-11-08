/**
 * Pixel art do Mistério, desenhada em código: retratos 12x12 dos suspeitos (rosto base + o que
 * cada um usa na cabeça) e ícones 9x9 dos lugares e objetos. Sem React: o teste importa daqui.
 */
export type Sprite = string[]

export const PAL: Record<string, string> = {
  k: '#0F0B09',
  s: '#E8B48A',
  S: '#C98E66',
  w: '#3B312C',
  W: '#6E5A4E',
  p: '#F3EBDD',
  d: '#B7A99A',
  y: '#FFC94A',
  r: '#E05A4A',
  g: '#6FD49B',
  G: '#3F8A5E',
  b: '#6FA3C7',
  B: '#3F6F94',
  v: '#9A86D9',
  n: '#E07A9A',
  h: '#7A5A44',
  H: '#D9D2C8'
}

function paint(g: string[][], row: number, col: number, patch: string): void {
  ;[...patch].forEach((ch, j) => {
    if (ch !== ' ' && g[row] && col + j < g[row].length) g[row][col + j] = ch
  })
}

/** rosto base: pele, olhos, boca, pescoço e a roupa na cor `c` */
function face(): string[][] {
  const g = Array.from({ length: 12 }, () => new Array<string>(12).fill('.'))
  for (let y = 3; y <= 7; y++) paint(g, y, 3, 'ssssss')
  paint(g, 3, 3, ' ssss ')
  paint(g, 5, 4, 'k  k')
  paint(g, 6, 3, 'S    S')
  paint(g, 7, 5, 'SS')
  paint(g, 8, 5, 'ss')
  paint(g, 9, 2, 'cccccccc')
  paint(g, 10, 1, 'cccccccccc')
  paint(g, 11, 1, 'cccccccccc')
  return g
}

/** o que cada suspeito tem na cabeça (patches por cima do rosto) */
const HEADS: Record<string, Array<[number, number, string]>> = {
  // governanta: coque grisalho
  odete: [
    [0, 5, 'HH'],
    [1, 4, 'HHHH'],
    [2, 3, 'HHHHHH'],
    [3, 2, 'H      H'],
    [4, 2, 'H      H'],
    [9, 5, 'pp']
  ],
  // jardineiro: boné verde e bigode
  valdir: [
    [1, 3, 'GGGGGG'],
    [2, 2, 'GGGGGGGG'],
    [3, 1, 'GGG'],
    [7, 4, 'hhhh']
  ],
  // sobrinha: cabelo curto e óculos
  lia: [
    [1, 3, 'hhhhhh'],
    [2, 2, 'hhhhhhhh'],
    [3, 2, 'h      h'],
    [4, 2, 'h      h'],
    [5, 3, 'kkk  kkk'],
    [9, 4, 'pppp']
  ],
  // músico: chapéu com fita amarela
  bene: [
    [0, 3, 'wwwwww'],
    [1, 3, 'wwwwww'],
    [2, 3, 'yyyyyy'],
    [3, 1, 'wwwwwwwwww'],
    [7, 4, 'hhhh']
  ],
  // vidente: turbante com pedra
  cleo: [
    [0, 4, 'nnnn'],
    [1, 3, 'nnnnnn'],
    [2, 2, 'nnnyynnn'],
    [3, 2, 'nnnnnnnn'],
    [6, 2, 'y      y']
  ],
  // motorista: quepe escuro com distintivo
  rafa: [
    [1, 3, 'wwwwww'],
    [2, 2, 'wwwyywww'],
    [3, 2, 'kkkkkkkk'],
    [4, 2, 'hh    hh']
  ]
}

export function portrait(id: string): Sprite {
  const g = face()
  for (const [r, c, patch] of HEADS[id] ?? []) paint(g, r, c, patch)
  return g.map((row) => row.join(''))
}

export const ICONS: Record<string, Sprite> = {
  varanda: ['....k....', '..kkykk..', '.kyyyyyk.', 'kkkkkkkkk', '.k.k.k.k.', '.k.k.k.k.', '.k.k.k.k.', 'kkkkkkkkk', '.........'],
  cozinha: ['.........', '...kkk...', '..kdddk..', 'kkkkkkkkk', '.kdddddk.', '.kdddddk.', '.kdddddk.', '..kkkkk..', '.........'],
  biblioteca: ['.........', 'krkbkgk..', 'krkbkgk..', 'krkbkgkyk', 'krkbkgkyk', 'krkbkgkyk', 'krkbkgkyk', 'kkkkkkkkk', '.........'],
  porao: ['kkkkkkkkk', 'k.......k', 'kkkk....k', 'k..kkk..k', 'k....kkkk', 'k......kk', 'k.......k', 'kkkkkkkkk', '.........'],
  sotao: ['.........', '....k....', '...kWk...', '..kWWWk..', '.kWWyWWk.', 'kWWWWWWWk', 'kkkkkkkkk', '.........', '.........'],
  jardim: ['...rrr...', '..rryrr..', '...rrr...', '....g....', '..g.g.g..', '...ggg...', '....g....', '.GGGGGGG.', '.........'],
  garagem: ['.........', '..kkkkk..', '.kbbbbbk.', 'kbbbbbbbk', 'kkkkkkkkk', '.kk...kk.', '.........', '.........', '.........'],
  adega: ['....k....', '...kGk...', '...kGk...', '..kGGGk..', '.kGGGGGk.', '.kGyyyGk.', '.kGGGGGk.', '.kGGGGGk.', '..kkkkk..'],
  'pe-de-cabra': ['.......kk', '......kdk', '.....kdk.', '....kdk..', '...kdk...', '..kdk....', '.kdk.....', 'kddk.....', '.kk......'],
  'guarda-chuva': ['....k....', '..kkrkk..', '.krrrrrk.', 'krrrrrrrk', 'kkkkkkkkk', '....k....', '....k....', '..k.k....', '...k.....'],
  escada: ['.k.....k.', '.kkkkkkk.', '.k.....k.', '.kkkkkkk.', '.k.....k.', '.kkkkkkk.', '.k.....k.', '.kkkkkkk.', '.k.....k.'],
  lanterna: ['.........', '.........', 'yy.......', 'yyykkkkk.', 'yyykdddkk', 'yyykkkkk.', 'yy.......', '.........', '.........'],
  chaves: ['..kkk....', '.kyyyk...', '.ky.yk...', '.kyyyk...', '..kyk....', '..kyk....', '..kyykk..', '..kyk....', '..kyykk..'],
  tesoura: ['k.......k', '.k.....k.', '..k...k..', '...k.k...', '....k....', '...kdk...', '..kdkdk..', '.kdk.kdk.', '.kk...kk.']
}

export interface Run {
  x: number
  y: number
  w: number
  fill: string
}

/** tiras de pixels iguais; 'c' vira a cor dada (a roupa do suspeito) */
export function runs(sprite: Sprite, color = '#B7A99A'): Run[] {
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
      out.push({ x, y, w, fill: ch === 'c' ? color : PAL[ch] })
      x += w
    }
  })
  return out
}
