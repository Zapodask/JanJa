/**
 * Arte dos tiles do Tiro na Sala. Cada chave `art` da LEGEND (src/shared/games/shooter/maps/legend.ts) tem uma
 * função que devolve o caractere de cada pixel. Móveis são desenhados no espaço do bloco retangular de tiles iguais
 * (sofá de 11 tiles = um sofá só), então a arte atravessa as junções.
 */
import type { Rows } from './palette'

export const TILE_PX = 16

export interface TileCtx {
  tx: number
  ty: number
  /** posição (em tiles) dentro do bloco retangular de tiles com a mesma arte, e o tamanho do bloco */
  bx: number
  by: number
  bw: number
  bh: number
  /** vizinhos com a mesma arte */
  nl: boolean
  nr: boolean
  nu: boolean
  nd: boolean
  /** o tile de cima é parede (sombra no chão) */
  wallAbove: boolean
  /** a arte de baixo desta peça (piso), já desenhada */
  variant: number
}

export type PixelFn = (x: number, y: number, c: TileCtx) => string

/** ruído determinístico 0..1 */
export function noise(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** espaço do bloco: X,Y em pixels dentro do retângulo de tiles iguais, W,H o tamanho dele */
const bl = (c: TileCtx, x: number, y: number) => ({ X: c.bx * TILE_PX + x, Y: c.by * TILE_PX + y, W: c.bw * TILE_PX, H: c.bh * TILE_PX })

// ------------------------------------------------------------------ pisos

const madeira: PixelFn = (x, y, c) => {
  const wx = c.tx * 16 + x
  const wy = c.ty * 16 + y
  const row = wy % 5
  const plank = Math.floor(wy / 5)
  if (row === 4) return 'n'
  const joint = (wx + ((plank * 37) % 53)) % 53
  if (joint === 0) return 'n'
  const r = noise(wx, wy, plank)
  if (r > 0.965) return 'M'
  if (r < 0.04) return 'n'
  return row === 0 && noise(plank, 1, 3) > 0.6 ? 'M' : 'm'
}

const ceramica: PixelFn = (x, y, c) => {
  const wx = c.tx * 16 + x
  const wy = c.ty * 16 + y
  if (wx % 8 === 7 || wy % 8 === 7) return 'z'
  const chk = ((wx >> 3) + (wy >> 3)) & 1
  const r = noise(wx, wy, 5)
  if (r > 0.97) return 'd'
  return chk ? 'P' : 'x'
}

const tapete: PixelFn = (x, y, c) => {
  const { X, Y, W, H } = bl(c, x, y)
  const edge = Math.min(X, Y, W - 1 - X, H - 1 - Y)
  if (edge === 0) return 'q'
  if (edge === 1) return (X + Y) % 2 === 0 ? 'y' : 'Y'
  if (edge === 2) return 'q'
  if (edge === 3) return 'R'
  // miolo: losangos
  const dx = Math.abs(((X % 12) + 12) % 12 - 6)
  const dy = Math.abs(((Y % 12) + 12) % 12 - 6)
  if (dx + dy === 3) return 'Y'
  if (dx + dy < 3) return 'O'
  return noise(X, Y, 9) > 0.93 ? 'q' : 'R'
}

const grama: PixelFn = (x, y, c) => {
  const wx = c.tx * 16 + x
  const wy = c.ty * 16 + y
  const r = noise(wx, wy, 11)
  if (r > 0.955) return 'j'
  if (r < 0.07) return 'L'
  // tufinhos em V
  if (noise(wx >> 2, wy >> 2, 17) > 0.86 && ((wx & 3) === 1 || (wx & 3) === 3) && (wy & 3) === 2) return 'j'
  return 'l'
}

const terra: PixelFn = (x, y, c) => {
  const wx = c.tx * 16 + x
  const wy = c.ty * 16 + y
  const r = noise(wx, wy, 23)
  if (r > 0.96) return 'N'
  if (r < 0.1) return 'm'
  if (r > 0.9 && r < 0.93) return 'i'
  return 'M'
}

const agua: PixelFn = (x, y, c) => {
  const wx = c.tx * 16 + x
  const wy = c.ty * 16 + y
  // borda da piscina de plástico: aro de 2 px onde não há mais água
  const rim = (c.nl ? 99 : x) < 2 || (c.nr ? 99 : 15 - x) < 2 || (c.nu ? 99 : y) < 2 || (c.nd ? 99 : 15 - y) < 2
  if (rim) {
    const o = Math.min(c.nl ? 99 : x, c.nr ? 99 : 15 - x, c.nu ? 99 : y, c.nd ? 99 : 15 - y)
    return o === 0 ? 'O' : 'o'
  }
  const wave = (wx + ((wy >> 1) % 2) * 2 + (wy >> 2) * 3) % 8
  if (wave === 0 && noise(wx >> 1, wy, 31) > 0.35) return 'a'
  if (wave === 3 || wave === 4) return noise(wx, wy >> 1, 33) > 0.5 ? 'c' : 'C'
  if (noise(wx, wy, 35) < 0.05) return 'B'
  return 'C'
}

const parede: PixelFn = (x, y, c) => {
  // face da frente nos 5 últimos pixels quando o tile de baixo não é parede
  const front = !c.nd
  const topH = front ? 11 : 16
  if (y >= topH) {
    const fy = y - topH
    if (fy === 0) return 'k'
    if (fy === 4) return 'k'
    const brick = ((c.tx * 16 + x + (fy < 2 ? 0 : 6)) % 12) === 0
    return brick ? 'k' : fy === 1 ? 'r' : 'w'
  }
  if (!c.nu && y === 0) return 'W'
  if (!c.nl && x === 0) return 'W'
  // topo: tijolo com juntas
  const wy = c.ty * 16 + y
  const row = Math.floor(wy / 4)
  if (wy % 4 === 3) return 'w'
  const off = (row % 2) * 6
  if ((c.tx * 16 + x + off) % 12 === 11) return 'w'
  return noise(c.tx * 16 + x, wy, 41) > 0.93 ? 'e' : 'r'
}

// ------------------------------------------------------------------ móveis (espaço do bloco)

/** peças longas: se o bloco for mais alto que largo, troca os eixos (costas à esquerda) */
function oriented(fn: (X: number, Y: number, W: number, H: number, c: TileCtx) => string): PixelFn {
  return (x, y, c) => {
    const { X, Y, W, H } = bl(c, x, y)
    return H > W ? fn(Y, X, H, W, c) : fn(X, Y, W, H, c)
  }
}

const sofa = oriented((X, Y, W, H) => {
  // H = 16 (profundidade). costas em cima, braços nas pontas, almofadas no meio
  if (X === 0 || X === W - 1 || Y === 0 || Y === H - 1) return 'k'
  if (X < 4 || X > W - 5) return Y < 3 ? 'V' : X === 3 || X === W - 4 ? 'V' : 'v'
  if (Y < 6) return Y === 1 ? 'v' : Y === 5 ? 'V' : 'v'
  const cush = Math.floor((W - 8) / Math.max(1, Math.round((W - 8) / 22)))
  const cx = (X - 4) % cush
  if (cx === 0 || cx === cush - 1) return 'V'
  if (Y > 12) return 'V'
  return Y === 6 ? 'd' : 'v'
})

const tv = oriented((X, Y, W, H) => {
  // móvel de madeira com a TV de tubo em cima, ao centro
  if (Y === 0 || Y === H - 1 || X === 0 || X === W - 1) return 'k'
  const sx0 = Math.floor(W / 2) - 20
  const sx1 = Math.floor(W / 2) + 20
  if (Y >= 2 && Y <= 10 && X >= sx0 && X <= sx1) {
    if (Y === 2 || Y === 10 || X === sx0 || X === sx1) return 'k'
    const glare = X - sx0 < 8 && Y - 2 < 4 && (X - sx0 + Y) % 2 === 0
    return glare ? 'c' : (X + Y) % 11 === 0 ? 'V' : 'v'
  }
  if (Y >= 11) return Y === 11 ? 'n' : X % 14 === 7 ? 'k' : 'm'
  return Y < 2 ? 'N' : 'm'
})

const balcao = (x: number, y: number, c: TileCtx): string => {
  const edgeL = !c.nl && x === 0
  const edgeR = !c.nr && x === 15
  const edgeU = !c.nu && y === 0
  const edgeD = !c.nd && y === 15
  if (edgeL || edgeR || edgeU || edgeD) return 'k'
  const { X, Y, W, H } = bl(c, x, y)
  // bancada de pedra clara com pia na ponta e frente de madeira embaixo
  if (!c.nd && y >= 12) return y === 12 ? 'D' : 'M'
  if (X > 0 && Y > 0 && X < W - 1 && Y < H - 1 && (X % 40 === 0 || (X % 40 === 1 && y < 12))) return 'd'
  if (c.bw >= 4 && X >= 6 && X <= 29 && Y >= 3 && Y <= 10 && (!c.nu || c.bh > 1)) {
    return X === 6 || X === 29 || Y === 3 || Y === 10 ? 'D' : (X + Y) % 7 === 0 ? 'c' : 'i'
  }
  return Y % 6 === 0 || X % 9 === 4 ? 'P' : 'p'
}

const mesaCentro: PixelFn = (x, y, c) => {
  const { X, Y, W, H } = bl(c, x, y)
  if (X === 0 || Y === 0 || X === W - 1 || Y === H - 1) return 'k'
  if (Y >= H - 4) return Y === H - 4 ? 'M' : 'n'
  if (X === 1 || Y === 1) return 'N'
  // objetos em cima: um copo e um livro
  if (X >= 6 && X <= 8 && Y >= 5 && Y <= 7) return X === 7 && Y === 6 ? 'o' : 'p'
  if (X >= W - 13 && X <= W - 6 && Y >= 5 && Y <= 9) return X === W - 13 || Y === 5 ? 'k' : 'v'
  return noise(X, Y, 51) > 0.95 ? 'M' : 'N'
}

const cama = oriented((X, Y, W, H) => {
  // vista de cima: travesseiros no topo (em Y pequeno de H=comprimento) — aqui X é o comprimento
  if (X === 0 || Y === 0 || X === W - 1 || Y === H - 1) return 'k'
  if (X < 3) return 'n'
  if (X < 18) {
    // dois travesseiros
    const half = Math.floor(H / 2)
    const inP = Y > 2 && Y < H - 3 && X > 3 && X < 16 && !(Y >= half - 1 && Y <= half)
    if (inP) return X === 4 || Y === 3 || Y === H - 4 ? 'P' : 'p'
    return 'x'
  }
  if (X === 18) return 'P'
  if (X < 25) return 'v' // dobra do lençol
  const stripe = Math.floor((Y + X) / 5) % 4 === 0
  if (X > W - 6) return 'V'
  return stripe ? 'V' : 'v'
})

const guardaRoupa = oriented((X, Y, W, H) => {
  if (X === 0 || Y === 0 || X === W - 1 || Y === H - 1) return 'k'
  if (X === 1 || Y === 1) return 'M'
  const doors = Math.max(2, Math.round(W / 24))
  const dw = W / doors
  const dx = X % dw
  if (Math.floor(dx) === 0 || Math.floor(dx) === Math.floor(dw) - 1) return 'n'
  if (Math.abs(dx - dw / 2) < 1.5 && Y > 4 && Y < 11) return 'y'
  return noise(X, Y, 61) > 0.96 ? 'M' : 'm'
})

const geladeira: PixelFn = (x, y, c) => {
  const { X, Y, W, H } = bl(c, x, y)
  if (X === 0 || Y === 0 || X === W - 1 || Y === H - 1) return 'k'
  if (X === 1 || Y === 1) return 'p'
  if (Y > H - 4 || X > W - 3) return 'D'
  // duas portas e puxadores
  if (X === Math.floor(W / 2)) return 'd'
  if (Y === 7 && X > 5 && X < W - 6) return 'd'
  if (Math.abs(X - W / 2) < 3 && Y > 9 && Y < 14) return 'i'
  return Y < 4 ? 'p' : 'P'
}

const fogao: PixelFn = (x, y, c) => {
  const { X, Y, W, H } = bl(c, x, y)
  if (X === 0 || Y === 0 || X === W - 1 || Y === H - 1) return 'k'
  if (X === 1 || Y === 1) return 'D'
  // quatro bocas
  const bx = [W * 0.27, W * 0.73]
  const by = [H * 0.27, H * 0.73]
  for (const cx of bx)
    for (const cy of by) {
      const d = Math.hypot(X - cx, Y - cy)
      if (d < 3) return d < 1.5 ? 'O' : 'k'
      if (d < 5 && d >= 4) return 'r'
    }
  return 'w'
}

const vaso: PixelFn = (x, y) => {
  const d = Math.hypot(x - 7.5, y - 8.5)
  if (d < 3.5) return 'O'
  if (d < 4.5) return 'k'
  const lx = x - 7.5
  const ly = y - 6
  const leaf = Math.hypot(lx, ly)
  if (leaf < 6.5 && noise(x, y, 71) > 0.15) return leaf > 5.4 ? 'F' : noise(x, y, 73) > 0.7 ? 'g' : 'G'
  if (leaf < 7.5) return 'k'
  return '.'
}

const mureta: PixelFn = (x, y, c) => {
  const wx = c.tx * 16 + x
  if (!c.nu && y < 2) return y === 0 ? 'k' : 'k'
  if (y < 3) return 'I'
  if (y < 5) return 'i'
  if (y === 5) return 'k'
  if (y > 13) return !c.nd ? 'k' : 'D'
  const row = Math.floor((y - 6) / 4)
  if ((y - 6) % 4 === 3) return 'D'
  return (wx + row * 5) % 10 === 0 ? 'D' : 'i'
}

const varal: PixelFn = (x, y, c) => {
  // postes nas pontas do bloco e um fio com roupas penduradas
  const { X, W } = bl(c, x, y)
  const isPost = X === 1 || X === W - 2
  if (isPost && y > 2) return y > 12 ? 'k' : 'D'
  if (isPost && y <= 2) return 'D'
  if (y === 5) return 'd'
  const col = Math.floor(X / 6)
  if (col % 2 === 1 && X > 3 && X < W - 4 && y >= 6 && y <= 11) {
    const tone = ['o', 'c', 'p', 'y'][Math.floor(noise(col, 1, 81) * 4)]!
    return (X % 6 === 5) ? '.' : y === 11 ? 'k' : tone
  }
  return '.'
}

const churrasqueira: PixelFn = (x, y, c) => {
  const { X, Y, W, H } = bl(c, x, y)
  const cx = W / 2
  const cy = H / 2
  const d = Math.hypot((X - cx) / 1, (Y - cy) / 1)
  if (d > W / 2 - 1) return '.'
  if (d > W / 2 - 2.2) return 'k'
  if (d > W / 2 - 4) return 'D'
  // brasas e grelha
  if (X % 3 === 0) return 'k'
  const r = noise(X, Y, 91)
  return r > 0.7 ? 'y' : r > 0.35 ? 'o' : 'O'
}

const arvore: PixelFn = (x, y) => {
  const d = Math.hypot(x - 7.5, y - 7.5)
  if (d > 7.6) return '.'
  if (d > 6.6) return 'k'
  const hl = x + y < 12 && d < 5
  const r = noise(x, y, 101)
  if (hl && r > 0.4) return 'g'
  if (x + y > 17 && d > 3) return 'f'
  return r > 0.8 ? 'h' : r < 0.2 ? 'F' : 'G'
}

const cerca: PixelFn = (x, y, c) => {
  // ripas verticais de 3 px com trilhos
  if (y > 14) return '.'
  if (y < 2) return '.'
  const wx = c.tx * 16 + x
  const slat = wx % 4
  if (slat === 3) return '.'
  if (y === 4 || y === 11) return 'n'
  if (y === 2) return slat === 0 ? '.' : 'k'
  if (slat === 0) return 'N'
  return 'M'
}

export type ArtFn = PixelFn

/** desenho de cada chave de arte (a mesma lista da LEGEND) */
export const TILE_ART: Record<string, ArtFn> = {
  'piso-madeira': madeira,
  'piso-ceramica': ceramica,
  tapete,
  grama,
  terra,
  parede,
  agua,
  sofa,
  tv,
  balcao,
  'mesa-centro': mesaCentro,
  cama,
  'guarda-roupa': guardaRoupa,
  geladeira,
  fogao,
  vaso,
  mureta,
  varal,
  churrasqueira,
  arvore,
  cerca
}

/** luzes ligadas a certos móveis: a TV azulada, o fogão e a brasa */
export const TILE_LIGHT: Record<string, { r: number; power: number; tint?: string }> = {
  tv: { r: 56, power: 0.85, tint: '#7FB7E6' },
  fogao: { r: 26, power: 0.5, tint: '#FF7A6B' },
  churrasqueira: { r: 38, power: 0.8, tint: '#FFC94A' },
  geladeira: { r: 20, power: 0.25 }
}

/** pisos que os móveis podem ter por baixo mesmo sem `floor` (arte transparente) */
export const FLOOR_KEYS: ReadonlySet<string> = new Set(['piso-madeira', 'piso-ceramica', 'tapete', 'grama', 'terra', 'agua', 'parede'])

/** arte de reserva para chave desconhecida: xadrez coral e preto com um X (bem visível de propósito) */
export const fallbackPixel: PixelFn = (x, y) => {
  if (x === y || x === 15 - y) return 'p'
  return ((x >> 2) + (y >> 2)) & 1 ? 'o' : 'k'
}

export function hasTileArt(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(TILE_ART, key)
}

const SHADOW_ROWS = 2

/** Desenha um tile completo (16x16): piso embaixo (se houver), a peça por cima e a sombra da parede no chão. */
export function tileRows(key: string, c: TileCtx, floorKey?: string): Rows {
  const fn = TILE_ART[key] ?? fallbackPixel
  const floorFn = floorKey ? (TILE_ART[floorKey] ?? fallbackPixel) : null
  // o piso de baixo é desenhado como miolo de um bloco enorme (sem bordas): o padrão segue a posição global
  const fctx: TileCtx = { ...c, bx: 100, by: 100, bw: 200, bh: 200, nl: true, nr: true, nu: true, nd: true }
  const rows: string[] = []
  for (let y = 0; y < TILE_PX; y++) {
    let line = ''
    for (let x = 0; x < TILE_PX; x++) {
      let ch = fn(x, y, c)
      if (ch === '.' && floorFn) ch = floorFn(x, y, fctx)
      // sombra da parede em cima: pontilhado nas duas primeiras linhas de qualquer piso
      if (c.wallAbove && ch !== '.' && y < SHADOW_ROWS && key !== 'parede') {
        const dark = y === 0 ? (x + y) % 2 === 0 || x % 4 === 1 : (x % 4 === 0 && y === 1) || false
        if (dark) ch = 'k'
      }
      line += ch
    }
    rows.push(line)
  }
  return rows
}
