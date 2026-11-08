/**
 * Luz barata em dithering: um disco de pontinhos (Bayer 4x4) por raio, em cache. A camada de escuridão é um canvas
 * do tamanho do quadro interno: enche de café com alfa e fura (destination-out) um disco por luz.
 */
import { BAYER4 } from '../../art/grid'

const cache = new Map<string, HTMLCanvasElement>()

/** nível de brilho (0..1) no raio relativo d (0 centro, 1 borda) */
export function falloff(d: number): number {
  if (d >= 1) return 0
  const k = 1 - d
  return k * k * (3 - 2 * k)
}

/** nível quantizado em 0, 1/2 ou 1 com ordenação de Bayer: a base do pontilhado */
export function ditherLevel(intensity: number, x: number, y: number): number {
  const t = Math.max(0, Math.min(1, intensity)) * 2
  const base = Math.floor(t)
  const frac = t - base
  const thr = (BAYER4[y & 3]![x & 3]! + 0.5) / 16
  return Math.min(2, base + (frac > thr ? 1 : 0)) / 2
}

/** disco de luz: alfa 0, .5 ou 1 pontilhado; `color` se quiser um brilho colorido (alfa multiplicado por `alpha`) */
export function lightDisc(radius: number, color: string | null = null, alpha = 1): HTMLCanvasElement {
  const r = Math.max(4, Math.round(radius / 2) * 2)
  const key = `${r}|${color ?? ''}|${alpha}`
  const hit = cache.get(key)
  if (hit) return hit
  const cv = document.createElement('canvas')
  cv.width = cv.height = r * 2
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(r * 2, r * 2)
  const rgb = color ? [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)] : [0, 0, 0]
  for (let y = 0; y < r * 2; y++)
    for (let x = 0; x < r * 2; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r
      const lv = ditherLevel(falloff(d), x, y)
      if (lv <= 0) continue
      const o = (y * r * 2 + x) * 4
      img.data[o] = rgb[0]!
      img.data[o + 1] = rgb[1]!
      img.data[o + 2] = rgb[2]!
      img.data[o + 3] = Math.round(255 * lv * alpha)
    }
  ctx.putImageData(img, 0, 0)
  cache.set(key, cv)
  return cv
}

export interface LightSpot {
  x: number
  y: number
  r: number
  /** 0..1 */
  power: number
  /** brilho colorido por cima (ex.: abajur #FFC94A) */
  tint?: string
}

export interface DarkConfig {
  /** escuridão ambiente 0..1 */
  ambient: number
  color: string
}

/** Desenha a camada de escuridão: `cam` é o canto da vista no mundo. */
export function drawDarkness(ctx: CanvasRenderingContext2D, w: number, h: number, cam: { x: number; y: number }, lights: readonly LightSpot[], dark: DarkConfig): void {
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, w, h)
  ctx.globalAlpha = dark.ambient
  ctx.fillStyle = dark.color
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'destination-out'
  for (const l of lights) {
    const disc = lightDisc(l.r)
    const x = Math.round(l.x - cam.x - disc.width / 2)
    const y = Math.round(l.y - cam.y - disc.height / 2)
    if (x > w || y > h || x + disc.width < 0 || y + disc.height < 0) continue
    ctx.globalAlpha = Math.max(0, Math.min(1, l.power))
    ctx.drawImage(disc, x, y)
  }
  ctx.globalCompositeOperation = 'source-over'
  for (const l of lights) {
    if (!l.tint) continue
    const disc = lightDisc(l.r * 0.85, l.tint, 0.2)
    const x = Math.round(l.x - cam.x - disc.width / 2)
    const y = Math.round(l.y - cam.y - disc.height / 2)
    if (x > w || y > h || x + disc.width < 0 || y + disc.height < 0) continue
    ctx.globalAlpha = Math.max(0, Math.min(1, l.power))
    ctx.drawImage(disc, x, y)
  }
  ctx.globalAlpha = 1
}
