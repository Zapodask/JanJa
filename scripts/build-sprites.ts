/**
 * Gera public/game/sprites.png + sprites.json (spritesheet do PixiJS v8: frames + animations)
 * e art-preview/preview.png (4x, tudo rotulado; fica fora do public/ para não ir ao site) a partir dos sprites em src/web/game/art/.
 * Uso: npm run sprites
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'
import { PALETTE, buildRegistry, expectedSize } from '../src/web/game/art'
import type { Registry, Sprite } from '../src/web/game/art'
import { tinyText } from '../src/web/game/art/glyphs'

const SHEET_W = 1024
const PAD = 1

export interface PackedFrame {
  name: string
  x: number
  y: number
  w: number
  h: number
}

const rgbaOf = (ch: string): [number, number, number, number] => {
  if (ch === '.') return [0, 0, 0, 0]
  const hex = PALETTE[ch]
  if (!hex) throw new Error(`chave fora da paleta: "${ch}"`)
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255]
}

/** Empacota em prateleiras (maiores primeiro), ordem determinística. */
export function pack(reg: Registry): { frames: PackedFrame[]; w: number; h: number } {
  const items = Object.entries(reg.sprites).map(([name, s]) => ({ name, w: s[0].length, h: s.length }))
  const order = [...items].sort((a, b) => b.h - a.h || b.w - a.w || a.name.localeCompare(b.name))
  const frames: PackedFrame[] = []
  let x = 0
  let y = 0
  let rowH = 0
  for (const it of order) {
    if (x + it.w + PAD > SHEET_W) {
      x = 0
      y += rowH + PAD
      rowH = 0
    }
    frames.push({ name: it.name, x, y, w: it.w, h: it.h })
    x += it.w + PAD
    rowH = Math.max(rowH, it.h)
  }
  const h = y + rowH
  return { frames, w: SHEET_W, h }
}

export function renderSheet(reg: Registry, packed: ReturnType<typeof pack>): PNG {
  const png = new PNG({ width: packed.w, height: packed.h })
  for (const f of packed.frames) {
    const s = reg.sprites[f.name]
    for (let j = 0; j < f.h; j++)
      for (let i = 0; i < f.w; i++) {
        const [r, g, b, a] = rgbaOf(s[j][i])
        const o = ((f.y + j) * packed.w + f.x + i) * 4
        png.data[o] = r
        png.data[o + 1] = g
        png.data[o + 2] = b
        png.data[o + 3] = a
      }
  }
  return png
}

export function sheetJson(reg: Registry, packed: ReturnType<typeof pack>) {
  const frames: Record<string, unknown> = {}
  for (const name of Object.keys(reg.sprites)) {
    const f = packed.frames.find((p) => p.name === name)!
    frames[name] = {
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h },
      sourceSize: { w: f.w, h: f.h }
    }
  }
  return {
    frames,
    animations: reg.animations,
    meta: { app: 'janja-sprites', version: '1', image: 'sprites.png', format: 'RGBA8888', size: { w: packed.w, h: packed.h }, scale: '1' }
  }
}

// ---------- tela RGBA para o preview ----------
class Canvas {
  readonly png: PNG
  constructor(
    readonly w: number,
    readonly h: number,
    bg: string
  ) {
    this.png = new PNG({ width: w, height: h })
    this.rect(0, 0, w, h, bg)
  }
  px(x: number, y: number, c: [number, number, number, number], mode: 'over' | 'add' = 'over', alpha = 1, tint?: [number, number, number]) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || c[3] === 0) return
    const o = (y * this.w + x) * 4
    const d = this.png.data
    let [r, g, b] = c
    if (tint) {
      r = (r * tint[0]) / 255
      g = (g * tint[1]) / 255
      b = (b * tint[2]) / 255
    }
    if (mode === 'add') {
      d[o] = Math.min(255, d[o] + r * alpha)
      d[o + 1] = Math.min(255, d[o + 1] + g * alpha)
      d[o + 2] = Math.min(255, d[o + 2] + b * alpha)
    } else {
      d[o] = d[o] * (1 - alpha) + r * alpha
      d[o + 1] = d[o + 1] * (1 - alpha) + g * alpha
      d[o + 2] = d[o + 2] * (1 - alpha) + b * alpha
    }
    d[o + 3] = 255
  }
  rect(x: number, y: number, w: number, h: number, ch: string) {
    const c = rgbaOf(ch)
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c)
  }
  sprite(s: Sprite, x: number, y: number, scale = 1, opt: { mode?: 'over' | 'add'; alpha?: number; tint?: [number, number, number] } = {}) {
    s.forEach((line, j) =>
      [...line].forEach((ch, i) => {
        if (ch === '.') return
        const c = rgbaOf(ch)
        for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) this.px(x + i * scale + a, y + j * scale + b, c, opt.mode, opt.alpha, opt.tint)
      })
    )
  }
  text(t: string, x: number, y: number, scale: number, ch = 'p') {
    const m = tinyText(t)
    const c = rgbaOf(ch)
    m.forEach((line, j) =>
      [...line].forEach((v, i) => {
        if (v !== '#') return
        for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) this.px(x + i * scale + a, y + j * scale + b, c)
      })
    )
  }
  scaled(src: Canvas, x: number, y: number, k: number) {
    for (let j = 0; j < src.h; j++)
      for (let i = 0; i < src.w; i++) {
        const o = (j * src.w + i) * 4
        const c: [number, number, number, number] = [src.png.data[o], src.png.data[o + 1], src.png.data[o + 2], 255]
        for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) this.px(x + i * k + a, y + j * k + b, c)
      }
  }
}

const hexRgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]

/** Cena de exemplo 480x270: monta tudo como a mesa vai montar, para avaliar o conjunto. */
function scene(reg: Registry): Canvas {
  const S = reg.sprites
  const c = new Canvas(480, 270, 'w')
  for (let y = 0; y < 270; y += 32) for (let x = 0; x < 480; x += 32) c.sprite(S.wall_tile, x, y)
  // TV pendurada (o vídeo entra no buraco)
  const tvx = 24
  const tvy = 16
  const tvw = 200
  const tvh = 84
  c.rect(tvx + 9, tvy + 9, tvw - 18, tvh - 18, 'k')
  for (let y = 0; y < tvh - 18; y++) for (let x = 0; x < tvw - 18; x++) if ((x + y) % 2 === 0) c.rect(tvx + 9 + x, tvy + 9 + y, 1, 1, ((x >> 3) + (y >> 3)) % 2 ? 'r' : 'b')
  const f9 = S.tv_frame_9slice
  const draw9 = (src: Sprite, x: number, y: number, w: number, h: number, b: number) => {
    const sw = src[0].length
    const sh = src.length
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const sx = i < b ? i : i >= w - b ? sw - (w - i) : b + ((i - b) % (sw - 2 * b))
        const sy = j < b ? j : j >= h - b ? sh - (h - j) : b + ((j - b) % (sh - 2 * b))
        const ch = src[sy][sx]
        if (ch !== '.') c.rect(x + i, y + j, 1, 1, ch)
      }
  }
  draw9(f9, tvx, tvy, tvw, tvh, 12)
  c.sprite(S.tv_hanger, tvx + 3, tvy - 13)
  c.sprite(S.tv_hanger, tvx + tvw - 35, tvy - 13)
  c.sprite(S.tv_led_on, tvx + tvw - 22, tvy + tvh - 6)
  // mesa
  const mx = 60
  const my = 118
  const mw = 360
  const mh = 134
  draw9(S.table_9slice, mx, my, mw, mh, 16)
  // luz do abajur
  const lx = mx + mw / 2
  const light = S.light_normal
  c.sprite(light, lx - 160, 40, 1, { mode: 'add', alpha: 0.2 })
  c.sprite(S.lamp, lx - 24, 0)
  // fichas
  c.sprite(S.chipstack_amber_5, lx - 30, my + 74)
  c.sprite(S.chipstack_coral_3, lx - 14, my + 80)
  c.sprite(S.chipstack_green_2, lx + 2, my + 76)
  c.sprite(S.chip_cream, lx + 16, my + 82)
  c.sprite(S.btn_dealer, mx + 70, my + 100)
  c.sprite(S.btn_sb, mx + 90, my + 104)
  c.sprite(S.btn_bb, mx + 110, my + 100)
  // flop
  const flop = ['card_Ah', 'card_10s', 'card_Kd', 'card_Qc', 'card_7h']
  flop.forEach((n, i) => c.sprite(S[n], lx - 96 + i * 38, my + 16))
  c.sprite(S.card_slot, lx + 94, my + 16)
  // mão do jogador (leque) e verso
  c.sprite(S.card_Js_hl, mx + 40, my + 82)
  c.sprite(S.card_9d, mx + 52, my + 84)
  c.sprite(S.card_back, mx + 270, my + 82)
  c.sprite(S.card_back, mx + 282, my + 84)
  // Jan carteador
  c.sprite(S.jan_shuffle_3, mx + mw / 2 - 12, my - 22)
  // avatares tingidos + timer
  const cols = ['#FFC94A', '#FF7A6B', '#6FD49B', '#7FB7E6']
  cols.forEach((hex, i) => {
    const t = hexRgb(hex)
    const ax = 8 + i * 0
    const ay = 120 + i * 36
    c.sprite(S.avatar_frame, ax, ay, 1, { tint: t })
    c.sprite(S[`timer_ring_${i * 3}`], ax, ay, 1, { tint: t })
    c.rect(ax + 4, ay + 4, 20, 20, ['m', 'F', 'n', 'h'][i])
  })
  // pódio e troféu no canto
  c.sprite(S.podium, 372, 150 + 40 - 66)
  c.sprite(S.trophy, 400, 150 + 40 - 66 - 16)
  // confete
  const conf = Object.values(reg.sprites).length ? ['confetti_amber', 'confetti_coral', 'confetti_green', 'confetti_cream', 'confetti_sky'] : []
  for (let i = 0; i < 40; i++) c.sprite(S[conf[i % 5]], 380 + ((i * 37) % 90), 100 + ((i * 53) % 50))
  return c
}

export function renderPreview(reg: Registry): PNG {
  const K = 4
  const PAGE_W = 2000
  const M = 16
  // 1) mede o layout
  interface Cell {
    name: string
    x: number
    y: number
    w: number
    h: number
  }
  const secs: { title: string; y: number; cells: Cell[] }[] = []
  let y = M
  for (const [title, names] of Object.entries(reg.sections)) {
    const sec = { title, y, cells: [] as Cell[] }
    y += 34
    let x = M
    let rowH = 0
    for (const name of names) {
      const s = reg.sprites[name]
      const w = Math.max(s[0].length * K, name.length * 8)
      const h = s.length * K
      if (x + w > PAGE_W - M && x > M) {
        x = M
        y += rowH + 36
        rowH = 0
      }
      sec.cells.push({ name, x, y, w, h })
      x += w + 16
      rowH = Math.max(rowH, h)
    }
    y += rowH + 36 + 16
    secs.push(sec)
  }
  const sc = scene(reg)
  const sceneY = y
  y += 34 + 270 * 2 + 40
  const cv = new Canvas(PAGE_W, y, 'w')
  for (const sec of secs) {
    cv.text(sec.title, M, sec.y + 4, 3, 'y')
    for (const cell of sec.cells) {
      const s = reg.sprites[cell.name]
      cv.rect(cell.x - 2, cell.y - 2, cell.w + 4, cell.h + 4, 'W')
      cv.sprite(s, cell.x, cell.y, K)
      cv.text(cell.name, cell.x, cell.y + cell.h + 8, 2, 'd')
    }
  }
  cv.text('CENA 480X270 (2X)', M, sceneY + 4, 3, 'y')
  cv.scaled(sc, M, sceneY + 34, 2)
  return cv.png
}

export function build(outDir: string, previewDir: string = outDir): { sheet: string; json: string; preview: string; count: number } {
  mkdirSync(outDir, { recursive: true })
  const reg = buildRegistry()
  for (const [name, s] of Object.entries(reg.sprites)) {
    const want = expectedSize(name)
    if (!want) throw new Error(`sprite sem tamanho esperado: ${name}`)
    if (s.length !== want[1] || s.some((l) => l.length !== want[0])) throw new Error(`${name}: tamanho errado (esperado ${want[0]}x${want[1]}, veio ${s[0]?.length}x${s.length})`)
  }
  const packed = pack(reg)
  const sheet = join(outDir, 'sprites.png')
  const json = join(outDir, 'sprites.json')
  // o preview é só para revisão: o CLI grava fora do public/ (não é publicado no site)
  mkdirSync(previewDir, { recursive: true })
  const preview = join(previewDir, 'preview.png')
  writeFileSync(sheet, PNG.sync.write(renderSheet(reg, packed)))
  writeFileSync(json, JSON.stringify(sheetJson(reg, packed)) + '\n')
  writeFileSync(preview, PNG.sync.write(renderPreview(reg)))
  return { sheet, json, preview, count: Object.keys(reg.sprites).length }
}

const here = dirname(fileURLToPath(import.meta.url))
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const out = process.argv[2] ?? resolve(here, '../public/game')
  const r = build(out, resolve(here, '..', 'art-preview'))
  console.log(`ok: ${r.count} quadros -> ${out}`)
}
