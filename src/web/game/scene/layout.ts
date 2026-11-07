/**
 * Layout puro da mesa (sem Pixi, sem DOM): escala inteira, ultrawide, geometria da sala,
 * assentos para 2..8 jogadores, retângulos das TVs e plano de fichas.
 * Coordenadas "internas" = pixels do canvas (480x270 base); o CSS só amplia por escala inteira.
 */
import type { Rect, SceneLayout } from '../contract'

export const BASE_W = 480
export const BASE_H = 270
export const MAX_W = 640
export const STRIP_H = 120
export const PORT_W = 270
export const TV_BORDER = 9
export const RAIL = 12

export type Orientation = 'land' | 'port'

export interface Viewport {
  orientation: Orientation
  /** inteira (>= 1) sempre que o container comporta; fracionária só em containers minúsculos */
  scale: number
  /** tamanho interno do canvas */
  w: number
  h: number
  cssW: number
  cssH: number
  /** deslocamento do canvas dentro do container (centralizado) */
  offX: number
  offY: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Escala inteira x1..xN centralizada; ultrawide aumenta a largura interna até 640 (altura fixa 270). */
export function computeViewport(cw: number, ch: number, layout: SceneLayout): Viewport {
  const strip = layout === 'faixa'
  const portrait = !strip && (cw < BASE_W || cw / Math.max(1, ch) < 0.85)
  let w: number
  let h: number
  let scale: number
  if (portrait) {
    const fit = Math.min(cw / PORT_W, ch / 480)
    scale = fit >= 1 ? Math.floor(fit) : Math.max(0.2, fit)
    w = clamp(Math.floor(cw / scale), PORT_W, 360)
    h = clamp(Math.floor(ch / scale), 480, 640)
  } else {
    const baseH = strip ? STRIP_H : BASE_H
    const fit = Math.min(cw / BASE_W, ch / baseH)
    scale = fit >= 1 ? Math.floor(fit) : Math.max(0.2, fit)
    w = clamp(Math.floor(cw / scale), BASE_W, MAX_W)
    h = baseH
  }
  const cssW = w * scale
  const cssH = h * scale
  return { orientation: portrait ? 'port' : 'land', scale, w, h, cssW, cssH, offX: Math.floor((cw - cssW) / 2), offY: Math.floor((ch - cssH) / 2) }
}

export interface TvSlot {
  frame: Rect
  hole: Rect
}

export interface SceneGeom {
  w: number
  h: number
  orientation: Orientation
  layout: SceneLayout
  table: Rect
  felt: Rect
  center: { x: number; y: number }
  /** semi-eixos da elipse dos assentos */
  rx: number
  ry: number
  lampX: number | null
  tvs: TvSlot[]
  /** sem telas compartilhadas: a TV desenhada é só decoração (desligada, com chiado) */
  tvDecor: boolean
  /** prateleira decorativa quando só há 1 TV (ou nenhuma) */
  shelf: Rect | null
  floorY: number
  jan: { x: number; y: number }
  deck: { x: number; y: number }
  board: { x: number; y: number }[]
  pot: { x: number; y: number }
  /** centro das minhas cartas e das minhas apostas */
  hand: { x: number; y: number }
  meBet: { x: number; y: number }
  compact: boolean
}

const even = (n: number) => Math.round(n)

/** Distribui até 8 TVs 16:9 numa faixa, deixando o centro livre para o abajur. */
export function tvSlots(count: number, w: number, bandTop: number, bandH: number, lampX: number): TvSlot[] {
  const n = clamp(Math.floor(count), 0, 8)
  if (n === 0) return []
  const gapC = 34 // meia largura livre em volta do abajur
  const margin = 8
  const gap = 6
  const leftN = Math.ceil(n / 2)
  const rightN = n - leftN
  const out: TvSlot[] = []
  const place = (k: number, x0: number, x1: number) => {
    if (k === 0) return
    const zone = x1 - x0
    // maior moldura 16:9 que cabe na altura da faixa e na largura da fatia
    let fw = Math.floor((zone - gap * (k - 1)) / k)
    const maxHoleH = bandH - 2 * TV_BORDER
    let holeW = fw - 2 * TV_BORDER
    let holeH = even((holeW * 9) / 16)
    if (holeH > maxHoleH) {
      holeH = maxHoleH
      holeW = even((holeH * 16) / 9)
      fw = holeW + 2 * TV_BORDER
    }
    const total = k * fw + (k - 1) * gap
    // encosta no abajur (centro) e não na borda
    const start = x0 + (zone - total) / 2
    for (let i = 0; i < k; i++) {
      const fx = even(start + i * (fw + gap))
      const fh = holeH + 2 * TV_BORDER
      const fy = bandTop + even((bandH - fh) / 2)
      out.push({ frame: { x: fx, y: fy, w: fw, h: fh }, hole: { x: fx + TV_BORDER, y: fy + TV_BORDER, w: holeW, h: holeH } })
    }
  }
  place(leftN, margin, lampX - gapC)
  place(rightN, lampX + gapC, w - margin)
  return out
}

export function computeScene(w: number, h: number, orientation: Orientation, layout: SceneLayout, tvCount: number): SceneGeom {
  const strip = layout === 'faixa'
  const cx = w / 2
  let table: Rect
  let bandTop = 14
  let bandH = 62
  if (strip) {
    table = { x: 34, y: 12, w: w - 68, h: 88 }
  } else if (orientation === 'port') {
    bandH = 64
    const ty = 118
    table = { x: 26, y: ty, w: w - 52, h: h - ty - 74 }
  } else {
    table = { x: 36, y: 92, w: w - 72, h: 130 }
  }
  const felt: Rect = { x: table.x + RAIL, y: table.y + RAIL, w: table.w - 2 * RAIL, h: table.h - 2 * RAIL }
  const center = { x: cx, y: table.y + table.h / 2 }
  const rx = table.w / 2 - 4
  const ry = table.h / 2 - 3
  const lampX = strip ? null : cx
  const tvs = strip ? [] : tvSlots(Math.max(1, tvCount), w, bandTop, bandH, cx)
  const shelf: Rect | null = strip || tvCount > 1 ? null : { x: cx + 44, y: bandTop + 50, w: Math.min(120, w - cx - 52), h: 5 }
  const boardY = strip ? center.y : center.y + 4
  const board = Array.from({ length: 5 }, (_, i) => ({ x: cx + (i - 2) * 36, y: boardY }))
  const compactHand = strip
  return {
    w,
    h,
    orientation,
    layout,
    table,
    felt,
    center,
    rx,
    ry,
    lampX,
    tvs,
    tvDecor: tvCount <= 0,
    shelf,
    floorY: strip ? h : table.y + 72,
    jan: { x: cx + 112, y: table.y + 2 },
    deck: { x: cx + 112, y: table.y + 24 },
    board,
    pot: { x: cx, y: felt.y + 11 },
    hand: compactHand ? { x: cx - 128, y: center.y + 24 } : { x: cx + 14, y: table.y + table.h + 16 },
    meBet: compactHand ? { x: cx - 128, y: center.y + 34 } : { x: cx + 70, y: table.y + table.h - 6 },
    compact: strip
  }
}

export interface SeatSpot {
  x: number
  y: number
  /** ângulo em graus a partir de baixo, no sentido horário */
  angle: number
  /** vetor unitário do assento para o centro da mesa */
  dx: number
  dy: number
  /** onde fica o nome: abaixo do avatar ou ao lado (assentos de cima) */
  label: 'below' | 'right' | 'left'
}

/** Posição do assento i de n (0 = a minha, embaixo no centro), distribuídos em elipse na borda da mesa. */
export function seatPositions(n: number, g: SceneGeom): SeatSpot[] {
  const out: SeatSpot[] = []
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n
    let x = g.center.x - g.rx * Math.sin(a)
    let y = g.center.y + g.ry * Math.cos(a)
    if (i === 0 && !g.compact) {
      // eu: embaixo, à esquerda das minhas cartas
      x = g.center.x - 46
      y = g.table.y + g.table.h - 2
    }
    x = Math.round(x)
    y = Math.round(y)
    const vx = g.center.x - x
    const vy = g.center.y - y
    const len = Math.hypot(vx, vy) || 1
    const top = Math.cos(a) < -0.25
    // na faixa o nome vai para fora; se não houver espaço até a borda (~48 px), vai para baixo do avatar
    const outer: SeatSpot['label'] = x >= g.center.x ? 'right' : 'left'
    const room = outer === 'right' ? g.w - x : x
    const label: SeatSpot['label'] = g.compact ? (room >= 64 || y < g.center.y - 10 ? outer : 'below') : top ? outer : 'below'
    out.push({ x: Math.round(x), y: Math.round(y), angle: Math.round((a * 180) / Math.PI), dx: vx / len, dy: vy / len, label })
  }
  return out
}

/** Retângulo CSS (relativo ao container) de um retângulo interno. */
export function toCss(r: Rect, vp: Viewport): Rect {
  return { x: vp.offX + r.x * vp.scale, y: vp.offY + r.y * vp.scale, w: r.w * vp.scale, h: r.h * vp.scale }
}

export function tvCssRects(g: SceneGeom, vp: Viewport): Rect[] {
  return g.tvDecor ? [] : g.tvs.map((t) => toCss(t.hole, vp))
}

// ---------- fichas proporcionais ao valor ----------
export type ChipColor = 'amber' | 'green' | 'coral' | 'cream'
export interface Pile {
  color: ChipColor
  /** 1..5 fichas (visual; 5 = "muitas") */
  count: number
}
const DENOMS: [ChipColor, number][] = [
  ['amber', 100],
  ['green', 25],
  ['coral', 10],
  ['cream', 5]
]

/** Até 3 pilhas (as maiores denominações), cada uma com 1..5 fichas. */
export function chipPlan(amount: number): Pile[] {
  let rest = Math.max(0, Math.floor(amount))
  const piles: Pile[] = []
  for (const [color, v] of DENOMS) {
    const c = Math.floor(rest / v)
    if (c > 0) piles.push({ color, count: Math.min(5, c) })
    rest -= c * v
  }
  if (rest > 0 && piles.length < 3) piles.push({ color: 'cream', count: 1 })
  return piles.slice(0, 3)
}

/** Nome do sprite da pilha de n fichas (existem 1, 2, 3 e 5; 4 usa a de 5). */
export function pileSprite(color: ChipColor, count: number): string {
  if (count <= 1) return `chip_${color}`
  if (count === 2) return `chipstack_${color}_2`
  if (count === 3) return `chipstack_${color}_3`
  return `chipstack_${color}_5`
}

/** Fichas de um stack: quantidade de pilhas e alturas crescem de forma suave com o valor. */
export function stackPlan(stack: number): Pile[] {
  if (stack <= 0) return []
  const piles = chipPlan(Math.min(stack, 2000))
  return piles.length ? piles : [{ color: 'cream', count: 1 }]
}

/** Nome de sprite da carta: 'Ts' -> 'card_10s'. */
export function cardSprite(card: string): string {
  const r = card[0] === 'T' ? '10' : card[0]
  return `card_${r}${card[1]}`
}
