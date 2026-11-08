/**
 * Partículas do Tiro na Sala, desenhadas direto num canvas 2D do tamanho do quadro interno (480x270).
 * Nada de Pixi aqui: só dados e fillRect, então é barato e fica nítido (pixel inteiro).
 */
import { SPAL } from './palette'

export type ParticleKind = 'spark' | 'smoke' | 'fire' | 'shell' | 'blood' | 'trail' | 'dust' | 'ring' | 'ghost' | 'streak' | 'puff'

export interface Particle {
  kind: ParticleKind
  x: number
  y: number
  vx: number
  vy: number
  /** altura falsa (cápsula pulando) */
  z: number
  vz: number
  age: number
  life: number
  size: number
  color: string
  /** extra: raio final (ring), ângulo (streak/shell), etc. */
  a: number
  b: number
}

export const MAX_PARTICLES = 700

const ZERO = { x: 0, y: 0, vx: 0, vy: 0, z: 0, vz: 0, age: 0, a: 0, b: 0 }

/** Gerador pseudoaleatório só visual (não mexe no jogo): mulberry32 */
export function visualRng(seed = 1): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Particles {
  list: Particle[] = []
  rnd = visualRng(7)

  add(p: Partial<Particle> & Pick<Particle, 'kind' | 'life' | 'color' | 'size'>): void {
    if (this.list.length >= MAX_PARTICLES) this.list.shift()
    this.list.push({ ...ZERO, ...p })
  }

  clear(): void {
    this.list.length = 0
  }

  /** faísca na parede: sai contra a direção do tiro */
  sparks(x: number, y: number, dirx: number, diry: number, n = 5): void {
    for (let i = 0; i < n; i++) {
      const omni = dirx === 0 && diry === 0
      const a = omni ? this.rnd() * Math.PI * 2 : Math.atan2(-diry, -dirx) + (this.rnd() - 0.5) * 1.8
      const sp = 40 + this.rnd() * 90
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.16 + this.rnd() * 0.14, color: this.rnd() < 0.5 ? SPAL.y! : SPAL.u!, size: 1 })
    }
    this.add({ kind: 'puff', x, y, life: 0.1, color: SPAL.p!, size: 3 })
  }

  /** cápsula ejetada: pula e quica uma vez */
  shell(x: number, y: number, ax: number, ay: number): void {
    const side = this.rnd() < 0.5 ? 1 : -1
    const sp = 38 + this.rnd() * 26
    this.add({
      kind: 'shell',
      x,
      y,
      vx: -ay * side * sp + ax * -8,
      vy: ax * side * sp + ay * -8,
      z: 4,
      vz: 70 + this.rnd() * 25,
      life: 0.75,
      color: SPAL.Y!,
      size: 2
    })
  }

  /** sangue de brinquedo: pontinhos de tinta do jogador */
  hitBurst(x: number, y: number, dirx: number, diry: number, color: string, n = 6): void {
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(diry, dirx) + (this.rnd() - 0.5) * 1.6
      const sp = 30 + this.rnd() * 80
      this.add({ kind: 'blood', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.25 + this.rnd() * 0.2, color, size: this.rnd() < 0.3 ? 2 : 1 })
    }
  }

  /** explosão: bola de fogo, brasas, fumaça e anel */
  explosion(x: number, y: number, radius: number): void {
    const n = Math.round(radius * 0.7)
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2
      const sp = this.rnd() * radius * 3.4
      this.add({ kind: 'fire', x: x + Math.cos(a) * 2, y: y + Math.sin(a) * 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.26 + this.rnd() * 0.24, color: this.rnd() < 0.5 ? SPAL.y! : SPAL.o!, size: 2 + Math.floor(this.rnd() * 3) })
    }
    for (let i = 0; i < 10; i++) {
      const a = this.rnd() * Math.PI * 2
      const sp = 14 + this.rnd() * radius * 1.1
      this.add({ kind: 'smoke', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10, life: 0.8 + this.rnd() * 0.7, color: i % 3 === 0 ? SPAL.D! : SPAL.e!, size: 5 + Math.floor(this.rnd() * 5) })
    }
    for (let i = 0; i < 12; i++) {
      const a = this.rnd() * Math.PI * 2
      const sp = 80 + this.rnd() * 130
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3 + this.rnd() * 0.3, color: SPAL.u!, size: 1 })
    }
    this.add({ kind: 'ring', x, y, life: 0.3, color: SPAL.p!, size: 1, a: radius })
  }

  /** nasceu: anel de poeira subindo */
  spawnBurst(x: number, y: number, color: string): void {
    this.add({ kind: 'ring', x, y, life: 0.4, color, size: 1, a: 14 })
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      this.add({ kind: 'spark', x: x + Math.cos(a) * 6, y: y + Math.sin(a) * 6, vx: Math.cos(a) * 12, vy: Math.sin(a) * 12 - 40, life: 0.45, color, size: 1 })
    }
  }

  /** fantasminha sobe de quem morreu */
  ghost(x: number, y: number, color: string): void {
    this.add({ kind: 'ghost', x, y: y - 6, vy: -22, vx: (this.rnd() - 0.5) * 6, life: 1.25, color, size: 1 })
  }

  /** poeira dos pés */
  dust(x: number, y: number): void {
    this.add({ kind: 'dust', x, y, vx: (this.rnd() - 0.5) * 8, vy: -4 - this.rnd() * 6, life: 0.3, color: SPAL.d!, size: 1 })
  }

  /** imagem residual do dash */
  afterimage(x: number, y: number, color: string): void {
    this.add({ kind: 'trail', x, y, life: 0.2, color, size: 8 })
  }

  /** rastro do rifle / rolha */
  streak(x: number, y: number, x2: number, y2: number, color: string, life = 0.12): void {
    this.add({ kind: 'streak', x, y, life, color, size: 1, a: x2, b: y2 })
  }

  step(dt: number): void {
    const g = 260
    const out: Particle[] = []
    for (const p of this.list) {
      p.age += dt
      if (p.age >= p.life) continue
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.kind === 'shell') {
        p.vz -= g * dt
        p.z += p.vz * dt
        if (p.z <= 0) {
          p.z = 0
          p.vz = p.vz < -30 ? -p.vz * 0.35 : 0
          p.vx *= 0.55
          p.vy *= 0.55
        }
      } else if (p.kind === 'smoke') {
        p.vx *= 1 - 2.2 * dt
        p.vy = p.vy * (1 - 2.2 * dt) - 6 * dt
      } else if (p.kind === 'fire') {
        p.vx *= 1 - 4 * dt
        p.vy *= 1 - 4 * dt
      } else if (p.kind === 'spark' || p.kind === 'blood') {
        p.vx *= 1 - 3 * dt
        p.vy *= 1 - 3 * dt
        if (p.kind === 'blood') p.vy += 40 * dt
      }
      out.push(p)
    }
    this.list = out
  }

  /** desenha tudo no contexto 2D do quadro interno (cam = canto de cima da vista no mundo) */
  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, w: number, h: number, ghostImg: (color: string) => CanvasImageSource | null, reduced: boolean): void {
    for (const p of this.list) {
      const t = p.age / p.life
      const sx = Math.round(p.x - camX)
      const sy = Math.round(p.y - camY)
      if (sx < -40 || sy < -40 || sx > w + 40 || sy > h + 40) continue
      switch (p.kind) {
        case 'spark':
          ctx.globalAlpha = 1 - t * t
          ctx.fillStyle = t < 0.4 ? p.color : SPAL.o!
          ctx.fillRect(sx, sy, p.size, p.size)
          break
        case 'blood':
          ctx.globalAlpha = 1 - t
          ctx.fillStyle = p.color
          ctx.fillRect(sx, sy, p.size, p.size)
          break
        case 'dust':
          ctx.globalAlpha = 0.5 * (1 - t)
          ctx.fillStyle = p.color
          ctx.fillRect(sx, sy, 1, 1)
          break
        case 'shell': {
          const sz = p.z > 0.5 ? 1 : 0
          ctx.globalAlpha = t > 0.8 ? 1 - (t - 0.8) * 5 : 1
          ctx.fillStyle = SPAL.Y!
          ctx.fillRect(sx, sy - Math.round(p.z), 2, 1 + sz)
          ctx.fillStyle = SPAL.y!
          ctx.fillRect(sx, sy - Math.round(p.z), 1, 1)
          break
        }
        case 'smoke': {
          const s = Math.round(p.size * (0.6 + t * 0.9))
          ctx.globalAlpha = (reduced ? 0.4 : 0.55) * (1 - t)
          ctx.fillStyle = p.color
          ctx.fillRect(sx - (s >> 1), sy - (s >> 1), s, s)
          break
        }
        case 'fire': {
          const s = Math.max(1, Math.round(p.size * (1 - t * 0.7)))
          ctx.globalAlpha = 1 - t * t
          ctx.fillStyle = t < 0.35 ? SPAL.u! : t < 0.65 ? p.color : SPAL.O!
          ctx.fillRect(sx - (s >> 1), sy - (s >> 1), s, s)
          break
        }
        case 'trail': {
          ctx.globalAlpha = (reduced ? 0.25 : 0.45) * (1 - t)
          ctx.fillStyle = p.color
          ctx.fillRect(sx - 4, sy - 7, 8, 12)
          break
        }
        case 'puff': {
          ctx.globalAlpha = 1 - t
          ctx.fillStyle = p.color
          const s = p.size
          ctx.fillRect(sx - 1, sy - (s >> 1), s, 1)
          ctx.fillRect(sx - (s >> 1), sy - 1, 1, s)
          break
        }
        case 'streak': {
          ctx.globalAlpha = 1 - t
          ctx.fillStyle = p.color
          lineTo(ctx, sx, sy, Math.round(p.a - camX), Math.round(p.b - camY))
          break
        }
        case 'ring': {
          const r = Math.round(2 + (p.a - 2) * easeOut(t))
          ctx.globalAlpha = reduced ? 0.4 * (1 - t) : 0.8 * (1 - t)
          ctx.fillStyle = p.color
          circle(ctx, sx, sy, r)
          break
        }
        case 'ghost': {
          const img = ghostImg(p.color)
          if (!img) break
          const wob = Math.round(Math.sin(p.age * 7) * 1.5)
          ctx.globalAlpha = (t < 0.7 ? 0.9 : 0.9 * (1 - (t - 0.7) / 0.3)) * (reduced ? 0.8 : 1)
          ctx.drawImage(img, sx - 5 + wob, sy - 5)
          break
        }
      }
    }
    ctx.globalAlpha = 1
  }
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t)

/** linha de pixels (Bresenham) */
export function lineTo(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let n = 0
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1)
    if ((x0 === x1 && y0 === y1) || n++ > 400) break
    const e2 = err * 2
    if (e2 > -dy) {
      err -= dy
      x0 += sx
    }
    if (e2 < dx) {
      err += dx
      y0 += sy
    }
  }
}

/** circunferência de pixels (ponto médio) */
export function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  let x = r
  let y = 0
  let err = 1 - r
  while (x >= y) {
    for (const [px, py] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]] as const) ctx.fillRect(cx + px, cy + py, 1, 1)
    y++
    if (err < 0) err += 2 * y + 1
    else {
      x--
      err += 2 * (y - x) + 1
    }
  }
}
