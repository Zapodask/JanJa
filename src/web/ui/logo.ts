/**
 * Logo do JanJa em pixel art: "JANJA" amarelo, subindo em degrau para a direita, com sombra preta
 * embaixo e contorno creme por fora. Tudo gerado aqui, sem imagem pronta.
 * Sem dependências do React: o teste importa este arquivo.
 */

export const LOGO_PALETTE: Record<string, string> = {
  y: '#FFC94A', // letra (abajur)
  k: '#0F0B09', // sombra
  c: '#FBD49F' // contorno
}

const LETTERS: Record<string, string[]> = {
  J: [
    '..XXXXXX',
    '..XXXXXX',
    '....XXX.',
    '....XXX.',
    '....XXX.',
    '....XXX.',
    'XXX.XXX.',
    'XXX.XXX.',
    'XXXXXXX.',
    '.XXXXX..'
  ],
  A: [
    '...XXX...',
    '..XXXXX..',
    '..XXXXX..',
    '.XXX.XXX.',
    '.XXX.XXX.',
    'XXXXXXXXX',
    'XXXXXXXXX',
    'XXX...XXX',
    'XXX...XXX',
    'XXX...XXX'
  ],
  N: [
    'XXX...XXX',
    'XXXX..XXX',
    'XXXXX.XXX',
    'XXXXXXXXX',
    'XXXXXXXXX',
    'XXX.XXXXX',
    'XXX..XXXX',
    'XXX...XXX',
    'XXX...XXX',
    'XXX...XXX'
  ]
}

const WORD = 'JANJA'
const GAP = 1 // colunas entre letras
const RISE = 7 // colunas por degrau de subida
const SHADOW = 1 // quanto a sombra desce
const PAD = 1 // contorno creme

function build(): string[] {
  const glyphH = LETTERS.J.length
  const inkW = [...WORD].reduce((w, ch, i) => w + LETTERS[ch][0].length + (i ? GAP : 0), 0)
  const lift = Math.floor((inkW - 1) / RISE)
  const W = inkW + 2 * (PAD + 1)
  const H = glyphH + lift + SHADOW + 2 * (PAD + 1)
  const g: string[][] = Array.from({ length: H }, () => Array<string>(W).fill('.'))
  const ox = PAD + 1
  const oy = PAD + 1

  // letras, cada coluna sobe 1 px a cada RISE colunas
  const ink: [number, number][] = []
  let x0 = 0
  for (const ch of WORD) {
    const glyph = LETTERS[ch]
    glyph.forEach((row, r) =>
      [...row].forEach((v, c) => {
        if (v !== 'X') return
        const x = x0 + c
        ink.push([ox + x, oy + lift - Math.floor(x / RISE) + r])
      })
    )
    x0 += glyph[0].length + GAP
  }
  const has = (x: number, y: number) => g[y]?.[x] !== undefined && g[y][x] !== '.'

  // sombra: a letra engordada 1 px e arrastada para baixo
  for (const [x, y] of ink)
    for (let dy = -1; dy <= SHADOW + 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (g[y + dy]?.[x + dx] !== undefined) g[y + dy][x + dx] = 'k'
  for (const [x, y] of ink) g[y][x] = 'y'

  // contorno: tudo que encosta (inclusive na diagonal) no desenho e está fora dele
  const out = g.map((row) => [...row])
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (has(x, y)) continue
      let near = false
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) near = has(x + dx, y + dy)
      if (near) out[y][x] = 'c'
    }
  return out.map((row) => row.join(''))
}

/** Grade da logo, uma letra da paleta por pixel ('.' = transparente). */
export const LOGO: string[] = build()
export const LOGO_W = LOGO[0].length
export const LOGO_H = LOGO.length

/** Runs horizontais da mesma cor: um <rect> por run. */
export function logoRects(): { x: number; y: number; w: number; fill: string }[] {
  const rects: { x: number; y: number; w: number; fill: string }[] = []
  LOGO.forEach((line, y) => {
    let x = 0
    while (x < line.length) {
      const ch = line[x]
      let end = x + 1
      while (end < line.length && line[end] === ch) end++
      if (ch !== '.') rects.push({ x, y, w: end - x, fill: LOGO_PALETTE[ch] })
      x = end
    }
  })
  return rects
}
