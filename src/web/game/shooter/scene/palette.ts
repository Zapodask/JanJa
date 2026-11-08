/**
 * Paleta do Tiro na Sala: a da casa à noite (café, abajur, papel, poeira) mais pisos, grama, água e fogo.
 * Uma letra = uma cor. `.` é transparente. `t`/`T` são a tinta do jogador (o runtime troca pela cor do apelido).
 */
export type Rows = string[]

export const SPAL: Record<string, string> = {
  k: '#0F0B09', // contorno
  w: '#221C19', // café (fundo)
  W: '#2E2622',
  r: '#3B312C',
  e: '#4A3E37', // piso escuro
  E: '#5E5048', // piso médio
  i: '#7A6C60', // concreto
  I: '#948779', // concreto claro
  p: '#F3EBDD', // papel
  P: '#D9CCB8',
  d: '#B7A99A', // poeira
  D: '#8B7E70',
  y: '#FFC94A', // abajur
  Y: '#E0A92E',
  u: '#FFE9A6', // brilho do abajur
  o: '#FF7A6B', // coral
  O: '#D9594B',
  R: '#A8392F',
  q: '#6E2A24', // vinho
  g: '#6FD49B',
  G: '#3FA070',
  f: '#1E3A2C',
  F: '#26493A',
  h: '#2F5A47',
  l: '#4D7F4A', // grama
  L: '#3C6A3D',
  j: '#678F4C', // grama clara
  m: '#6B4428',
  M: '#8A5A34',
  n: '#4A2E1B',
  N: '#A9743F', // madeira clara
  s: '#E8B48A',
  S: '#C98E66',
  c: '#7FB7E6', // água
  C: '#4F8FC4',
  B: '#2F6290',
  a: '#BFE3F5', // espuma
  x: '#E7DCC8', // azulejo
  z: '#9C8F7E', // azulejo sombra
  v: '#5B7C99', // azul poeirento (colcha, TV)
  V: '#3F5A73',
  b: '#3B312C', // calça
  t: '#FFFFFF',
  T: '#B4B4B4'
}

export const SPAL_KEYS = new Set(['.', ...Object.keys(SPAL)])

export const hexNum = (c: string): number => parseInt(c.replace('#', ''), 16)

export function rgbOf(ch: string): [number, number, number] {
  const hex = SPAL[ch]
  if (!hex) throw new Error(`chave fora da paleta: "${ch}"`)
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

/** multiplica uma cor #rrggbb por k (0..1+) */
export function shade(color: string, k: number): string {
  const n = hexNum(color)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
  const r = c((n >> 16) & 255)
  const g = c((n >> 8) & 255)
  const b = c(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/** cor de cada letra para um jogador: `t` = a cor do apelido e `T` = a sombra dela */
export function tintedPalette(tint: string): Record<string, string> {
  return { ...SPAL, t: tint, T: shade(tint, 0.68) }
}

/** Desenha as linhas num canvas (a cor de `t`/`T` vem da paleta passada). */
export function rowsToCanvas(rows: Rows, pal: Record<string, string> = SPAL): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = rows[0]!.length
  cv.height = rows.length
  const ctx = cv.getContext('2d')!
  rows.forEach((line, y) =>
    [...line].forEach((ch, x) => {
      if (ch === '.') return
      const c = pal[ch]
      if (!c) return
      ctx.fillStyle = c
      ctx.fillRect(x, y, 1, 1)
    })
  )
  return cv
}
