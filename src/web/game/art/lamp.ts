import { Grid, bayer } from './grid'
import type { Sprite } from './palette'

/** Abajur pendurado 48x40: fio, tampa, cúpula em semicírculo, aro e lâmpada acesa. */
export function lamp(): Sprite {
  const W = 48
  const g = new Grid(W, 40)
  const cx = 23.5
  // teto e fio
  g.rect(20, 0, 8, 2, 'k').rect(21, 0, 6, 1, 'r')
  g.rect(23, 2, 2, 8, 'k').rect(23, 2, 1, 8, 'd')
  // tampa
  g.rect(20, 10, 8, 4, 'k').rect(21, 10, 6, 3, 'Y').rect(21, 10, 3, 1, 'y').rect(21, 12, 6, 1, 'Y')
  // cúpula: raio cresce em arco (de 5 a 23 px) entre as linhas 14 e 33
  const top = 14
  const bot = 33
  const hwAt = (r: number) => {
    const t = (r - top) / (bot - top)
    return 5 + 18.5 * Math.sqrt(1 - (1 - t) * (1 - t))
  }
  for (let r = top; r <= bot; r++) {
    const hw = hwAt(r)
    const x0 = Math.round(cx - hw)
    const x1 = Math.round(cx + hw)
    for (let x = x0; x <= x1; x++) {
      const u = (x - cx) / hw // -1..1
      const v = (r - top) / (bot - top)
      let ch = 'y'
      if (u > 0.15) ch = 'Y'
      if (u > 0.0 && u <= 0.15 && (x + r) % 2 === 0) ch = 'Y'
      if (u > 0.55 && (x + r) % 2 === 0) ch = 'O'
      if (v > 0.9) ch = 'Y'
      // brilho especular curto, em cima à esquerda
      if (u < -0.45 && u > -0.7 && v > 0.15 && v < 0.55) ch = 'p'
      if (x === x0 || x === x1) ch = 'k'
      g.set(x, r, ch)
    }
  }
  // costelas
  for (const u of [-0.5, 0.05, 0.6]) {
    for (let r = top + 2; r < bot - 1; r++) {
      const x = Math.round(cx + u * hwAt(r))
      if (g.get(x, r) !== 'k') g.set(x, r, u > 0 ? 'O' : 'Y')
    }
  }
  // aro inferior (elipse achatada) com a lâmpada acesa dentro
  for (let x = 0; x < W; x++) {
    const u = (x - cx) / 23.5
    if (Math.abs(u) > 1) continue
    const h = Math.round(2.4 * Math.sqrt(1 - u * u))
    for (let dy = -h; dy <= h; dy++) {
      const ch = Math.abs(dy) === h ? 'k' : Math.abs(u) < 0.55 ? (Math.abs(u) < 0.25 ? 'p' : 'y') : 'Y'
      g.set(x, 34 + dy, ch)
    }
  }
  // bulbo aparece embaixo do aro
  g.rect(20, 36, 8, 1, 'y').rect(21, 37, 6, 1, 'p').rect(22, 38, 4, 1, 'p').rect(23, 39, 2, 1, 'y')
  g.rect(19, 35, 1, 1, 'y').rect(28, 35, 1, 1, 'y')
  return g.toSprite()
}

/**
 * Máscara de luz: cone saindo do abajur + poça de luz na mesa, em dithering de Bayer.
 * Níveis: Y (fraco), y (médio), p (quente). Use blend aditivo/screen com alpha baixo.
 */
function lightMask(W: number, H: number, coneEnd: number, apexHalf: number, endHalf: number, poolCy: number, poolRx: number, poolRy: number): Sprite {
  const g = new Grid(W, H)
  const cx = (W - 1) / 2
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = Math.abs(x - cx)
      let I = 0
      if (y < coneEnd + 20) {
        const t = y / coneEnd
        const hw = apexHalf + (endHalf - apexHalf) * Math.min(t, 1)
        if (dx < hw) I = Math.max(I, Math.pow(1 - dx / hw, 1.7) * (0.1 + 0.2 * Math.min(t, 1)))
      }
      const q = Math.hypot(dx / poolRx, (y - poolCy) / poolRy)
      if (q < 1) I = Math.max(I, Math.pow(1 - q, 0.8) * 1.05)
      const lvl = Math.floor(Math.min(I, 0.999) * 3 + bayer(x, y))
      g.set(x, y, lvl <= 0 ? '.' : lvl === 1 ? 'Y' : lvl === 2 ? 'y' : 'p')
    }
  return g.toSprite()
}
export const lightNormal = (): Sprite => lightMask(320, 200, 120, 14, 150, 150, 156, 52)
export const lightSpot = (): Sprite => lightMask(120, 200, 140, 6, 54, 168, 56, 30)
