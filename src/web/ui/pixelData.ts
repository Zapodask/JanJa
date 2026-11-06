/**
 * Jan, o mascote do JanJa, e a TV pixel. Cada quadro é uma grade 24x24 de letras (uma cor por letra).
 * Sem dependências do React: o teste e o script do preview importam este arquivo.
 */
export type Frame = string[]

export const SIZE = 24

export const PALETTE: Record<string, string> = {
  k: '#0F0B09', // contorno e olhos (mais escuro que o fundo, para a silhueta aparecer)
  y: '#FFC94A', // gorro
  Y: '#E0A92E', // sombra do gorro
  s: '#E8B48A', // pele
  S: '#C98E66', // sombra da pele
  o: '#FF7A6B', // moletom
  O: '#D9594B', // sombra do moletom
  b: '#3B312C', // calça, sapato, moldura
  p: '#F3EBDD', // brilho
  g: '#6FD49B' // LED do controle
}

const B = '.'.repeat(SIZE)

/** Escreve `s` em (row, col); espaço no patch = deixa como está. */
function paint(f: Frame, row: number, col: number, s: string): Frame {
  return f.map((line, i) => {
    if (i !== row) return line
    const cells = [...line]
    ;[...s].forEach((ch, j) => {
      if (ch !== ' ') cells[col + j] = ch
    })
    return cells.join('')
  })
}

/** Copia o retângulo para cima/baixo (dy) e limpa o que sobrou. */
function shiftRegion(f: Frame, r0: number, r1: number, c0: number, c1: number, dy: number): Frame {
  const out = f.map((l) => [...l])
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out[r][c] = '.'
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const ch = f[r][c]
      if (ch !== '.' && out[r + dy]) out[r + dy][c] = ch
    }
  return out.map((l) => l.join(''))
}

// ---------- Jan em pé (base) ----------
const STAND: Frame = [
  '..........kkkk..........', //  0 pompom
  '.........kyyyyk.........', //  1
  '.........kyYYyk.........', //  2
  '.......kkkkkkkkkk.......', //  3 gorro
  '......kyyyyyyyyyyk......', //  4
  '.....kyyyyyyyyyyyyk.....', //  5
  '.....kyyyyyyyyyyyyk.....', //  6
  '.....kYYYYYYYYYYYYk.....', //  7 barra do gorro
  '.....kssssssssssssk.....', //  8 testa
  '.....kssskssssksssk.....', //  9 olhos
  '.....kssskssssksssk.....', // 10
  '.....ksSssssssssSsk.....', // 11 bochechas
  '......kssssssssssk......', // 12
  '.......kkkkkkkkkk.......', // 13 queixo
  '......kooooooooook......', // 14 moletom
  '......kOooooooooOk......', // 15
  '......kOooooooooOk......', // 16
  '......kOooooooooOk......', // 17
  '......ksoooooooosk......', // 18 mãos
  '......kOOOOOOOOOOk......', // 19 barra do moletom
  '.......kbbbkkbbbk.......', // 20 pernas
  '.......kbbbkkbbbk.......', // 21
  '......kbbbbkkbbbbk......', // 22 sapatos
  '......kkkkkkkkkkkk......' // 23 solas
]

const squash = (f: Frame): Frame => [B, ...f.slice(0, 14), ...f.slice(15)]
/** olhos fechados: a linha de cima dos olhos vira pele */
const closeEyes = (f: Frame, row = 9): Frame => f.map((l, i) => (i === row ? f[row - 1] : l))
/** olhos 1 px para a direita (olhando para a TV) */
const lookRight = (f: Frame, rows: number[] = [9, 10]): Frame =>
  rows.reduce((acc, r) => paint(paint(acc, r, 9, 'sk'), r, 14, 'sk'), f)

// ---------- idle: respira e pisca ----------
const IDLE: Frame[] = [STAND, STAND, squash(STAND), squash(STAND), closeEyes(STAND)]

// ---------- remote: levanta o controle e aponta ----------
function remoteArm(ledOn: boolean): Frame {
  let f = STAND
  f = paint(f, 13, 21, 'kkk')
  f = paint(f, 14, 17, ledOn ? 'kkkkbgk' : 'kkkkbbk')
  f = paint(f, 15, 17, 'ooosbbk')
  f = paint(f, 16, 17, 'kkkkkkk')
  return f
}
const REMOTE: Frame[] = [remoteArm(true), remoteArm(false), squash(remoteArm(true)), remoteArm(false)]

// ---------- wait: sentado no chão olhando a TV ----------
const SEAT_LOWER: Frame = [
  '......kooooooooook......', // 17
  '......kOooooooooOk......', // 18
  '......ksoooooooosk......', // 19 mãos no colo
  '......kOOOOOOOOOOk......', // 20
  '.......kbbbbbbbbbbbbbbk.', // 21 pernas esticadas para a direita
  '.......kbbbbbbbbbbbbbbk.', // 22
  '.......kkkkkkkkkkkkkkkk.' // 23
]
const SEAT: Frame = lookRight([B, B, B, ...STAND.slice(0, 14), ...SEAT_LOWER], [12, 13])
const SEAT_FEET = shiftRegion(SEAT, 21, 23, 19, 23, -1)
const SEAT_BLINK = closeEyes(SEAT, 12)
const SEAT_USER = [B, B, B, ...STAND.slice(0, 14), ...SEAT_LOWER]
const SHRUG_A = paint(paint(SEAT_USER, 18, 4, 'kss'), 18, 17, 'ssk')
const SHRUG_B = paint(paint([B, B, B, B, ...STAND.slice(0, 13), ...SEAT_LOWER.slice(0, 6), SEAT_LOWER[6]].slice(0, 24), 17, 4, 'kss'), 17, 17, 'ssk')
const WAIT: Frame[] = [SEAT, SEAT_FEET, SEAT_BLINK, SEAT_USER, SHRUG_A, SHRUG_B]

// ---------- walk: caminhada de 4 quadros no lugar ----------
const legs = (rows: string[]): Frame => [...STAND.slice(0, 20), ...rows]
const WALK_UP = lookRight(STAND)
const WALK_APART = lookRight(
  legs([
    '......kbbbk..kbbbk......',
    '.....kbbbk....kbbbk.....',
    '....kbbbbk....kbbbbk....',
    '....kkkkkk....kkkkkk....'
  ])
)
const WALK: Frame[] = [WALK_APART, WALK_UP, squash(WALK_APART), squash(WALK_UP)]

// ---------- wave: acena para o convidado ----------
function wave(tilt: boolean): Frame {
  const c = tilt ? 1 : 0
  let f = STAND
  f = paint(f, 6, 20 + c, 'kk')
  f = paint(f, 7, 19 + c, 'kssk')
  f = paint(f, 8, 19 + c, 'kssk')
  for (let r = 9; r <= 14; r++) f = paint(f, r, 19, 'koOk')
  f = paint(f, 14, 17, 'oo')
  f = paint(f, 15, 18, 'kk')
  return f
}
const WAVE: Frame[] = [wave(false), wave(true), wave(false), wave(true)]

export type PoseName = 'idle' | 'remote' | 'wait' | 'walk' | 'wave'

interface PoseDef {
  frames: Frame[]
  /** ordem dos quadros no ciclo */
  seq: number[]
  /** duração de cada passo em ms */
  ms: number
}

export const POSES: Record<PoseName, PoseDef> = {
  // ~1 Hz respirando; pisca uma vez a cada ~4 s
  idle: { frames: IDLE, seq: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 4, 3], ms: 250 },
  remote: { frames: REMOTE, seq: [0, 1, 0, 1, 2, 1], ms: 220 },
  // balança os pés; de vez em quando olha para o usuário e dá de ombros (~6 s)
  wait: {
    frames: WAIT,
    seq: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2, 0, 1, 0, 1, 0, 1, 3, 3, 4, 5, 4, 5, 3, 3, 0, 1],
    ms: 250
  },
  walk: { frames: WALK, seq: [0, 1, 2, 3], ms: 125 },
  wave: { frames: WAVE, seq: [0, 1, 0, 1, 2, 3], ms: 220 }
}

// ---------- TV pixel (Home) ----------
function tvBase(): Frame {
  let f: Frame = Array(SIZE).fill(B)
  f = paint(f, 1, 7, 'k')
  f = paint(f, 1, 16, 'k')
  f = paint(f, 2, 8, 'k')
  f = paint(f, 2, 15, 'k')
  f = paint(f, 3, 9, 'k')
  f = paint(f, 3, 14, 'k')
  f = paint(f, 4, 2, 'kkkkkkkkkkkkkkkkkkkk')
  for (let r = 5; r <= 18; r++) f = paint(f, r, 2, 'kbbbbbbbbbbbbbbbbbbk')
  f = paint(f, 19, 2, 'kkkkkkkkkkkkkkkkkkkk')
  for (let r = 6; r <= 17; r++) f = paint(f, r, 4, 'kkkkkkkkkkkkk')
  f = paint(f, 7, 18, 'pp')
  f = paint(f, 10, 18, 'pp')
  for (const r of [13, 15, 17]) f = paint(f, r, 18, 'kk')
  f = paint(f, 20, 4, 'kbk')
  f = paint(f, 20, 17, 'kbk')
  f = paint(f, 21, 4, 'kkk')
  f = paint(f, 21, 17, 'kkk')
  return f
}
const TV_BASE = tvBase()
const screen = (f: Frame, rows: [number, string][]): Frame => rows.reduce((acc, [r, s]) => paint(acc, r, 5, s), f)

const TV_OFF = TV_BASE
const TV_LINE = screen(TV_BASE, [[11, 'pppppppppppp']])
const TV_OPEN = screen(TV_BASE, [
  [9, 'pppppppppppp'],
  [10, 'pppppppppppp'],
  [11, 'pppppppppppp'],
  [12, 'pppppppppppp'],
  [13, 'pppppppppppp']
])
const TV_FLASH = screen(
  TV_BASE,
  Array.from({ length: 10 }, (_, i): [number, string] => [7 + i, 'pppppppppppp'])
)
const TV_ON = screen(TV_BASE, [
  [7, 'yyyyyyyyyyyy'],
  [8, 'yyyyyyyyyyyy'],
  [9, 'yyyyyyyyyyyy'],
  [10, 'yyyyyyyypyyy'],
  [11, 'yyyyyyyyyyyy'],
  [12, 'yyyyyyyyyyyy'],
  [13, 'yyyyyyyyyyyy'],
  [14, 'YYYYYYYYYYYY'],
  [15, 'YYYYYYYYYYYY'],
  [16, 'YYYYYYYYYYYY']
])
/** índice 0 = desligada; o resto é a sequência de ligar */
export const TV_FRAMES: Frame[] = [TV_OFF, TV_LINE, TV_OPEN, TV_FLASH, TV_ON]

// ---------- saída SVG ----------
/** Junta runs horizontais da mesma cor: um <rect> por run. */
export function frameRects(frame: Frame): { x: number; y: number; w: number; fill: string }[] {
  const rects: { x: number; y: number; w: number; fill: string }[] = []
  frame.forEach((line, y) => {
    let x = 0
    while (x < line.length) {
      const ch = line[x]
      let end = x + 1
      while (end < line.length && line[end] === ch) end++
      if (ch !== '.') rects.push({ x, y, w: end - x, fill: PALETTE[ch] })
      x = end
    }
  })
  return rects
}

/** SVG completo de um quadro, como texto (usado no preview estático). */
export function spriteToSvg(frame: Frame, px = 4): string {
  const rects = frameRects(frame)
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="1" fill="${r.fill}"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE * px}" height="${SIZE * px}" shape-rendering="crispEdges">${rects}</svg>`
}
