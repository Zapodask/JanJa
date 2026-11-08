/**
 * Gera os ícones do app (PWA) em public/icons/ a partir da TV pixel de src/web/ui/pixelData.ts:
 * a TV ligada, centralizada no fundo café, com margem para o recorte redondo (maskable).
 * Uso: npm run icons
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { PALETTE, SIZE, TV_FRAMES } from '../src/web/ui/pixelData'

const WALL = '#221C19'
const OUT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../public/icons')

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16)
]

function render(size: number): Buffer {
  const tv = TV_FRAMES[TV_FRAMES.length - 1]
  // a arte ocupa 75% do ícone: cabe na zona segura do maskable (80%)
  const scale = Math.floor((size * 0.75) / SIZE)
  const offset = Math.floor((size - SIZE * scale) / 2)
  const png = new PNG({ width: size, height: size })
  const [wr, wg, wb] = rgb(WALL)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const cx = Math.floor((x - offset) / scale)
      const cy = Math.floor((y - offset) / scale)
      const key = x >= offset && y >= offset && cx < SIZE && cy < SIZE ? tv[cy][cx] : '.'
      const [r, g, b] = key === '.' ? [wr, wg, wb] : rgb(PALETTE[key])
      png.data[i] = r
      png.data[i + 1] = g
      png.data[i + 2] = b
      png.data[i + 3] = 255
    }
  return PNG.sync.write(png)
}

mkdirSync(OUT, { recursive: true })
for (const size of [192, 512]) {
  const file = join(OUT, `icon-${size}.png`)
  writeFileSync(file, render(size))
  console.log('gerado', file)
}
