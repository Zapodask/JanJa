/**
 * Texto pequeno e nítido para o quadro interno de 480x270: Pixelify Sans em 8 px, sem suavização (limiar de alfa),
 * com contorno escuro de 1 px. Uma textura por (texto, cor), em cache.
 */
import { CanvasSource, Texture } from 'pixi.js'

export const LABEL_FONT = '"Pixelify Sans Variable", monospace'
const OUTLINE = '#0F0B09'

const cache = new Map<string, Texture>()
let order: string[] = []

export function labelTexture(text: string, color: string, size = 11): Texture {
  const key = `${size}|${color}|${text}`
  const hit = cache.get(key)
  if (hit) return hit
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = `500 ${size}px ${LABEL_FONT}`
  const tw = Math.ceil(probe.measureText(text).width)
  const w = tw + 4
  const h = size + 5
  const src = document.createElement('canvas')
  src.width = w
  src.height = h
  const sx = src.getContext('2d', { willReadFrequently: true })!
  sx.font = `500 ${size}px ${LABEL_FONT}`
  sx.fillStyle = '#fff'
  sx.textBaseline = 'top'
  sx.fillText(text, 2, 2)
  const d = sx.getImageData(0, 0, w, h)
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) mask[i] = d.data[i * 4 + 3]! > 120 ? 1 : 0
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ox = out.getContext('2d')!
  const img = ox.createImageData(w, h)
  const fill = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]
  const ol = [parseInt(OUTLINE.slice(1, 3), 16), parseInt(OUTLINE.slice(3, 5), 16), parseInt(OUTLINE.slice(5, 7), 16)]
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (mask[y * w + x]) {
        img.data[o] = fill[0]!
        img.data[o + 1] = fill[1]!
        img.data[o + 2] = fill[2]!
        img.data[o + 3] = 255
        continue
      }
      let near = false
      for (let b = -1; b <= 1 && !near; b++)
        for (let a = -1; a <= 1; a++) {
          const nx = x + a
          const ny = y + b
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) {
            near = true
            break
          }
        }
      if (near) {
        img.data[o] = ol[0]!
        img.data[o + 1] = ol[1]!
        img.data[o + 2] = ol[2]!
        img.data[o + 3] = 255
      }
    }
  ox.putImageData(img, 0, 0)
  const tex = new Texture({ source: new CanvasSource({ resource: out, scaleMode: 'nearest' }) })
  cache.set(key, tex)
  order.push(key)
  if (order.length > 300) {
    const old = order.shift()!
    cache.get(old)?.destroy(true)
    cache.delete(old)
  }
  return tex
}

export function clearLabelCache(): void {
  for (const t of cache.values()) t.destroy(true)
  cache.clear()
  order = []
}
