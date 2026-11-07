import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { PALETTE, buildRegistry, expectedSize } from '../src/web/game/art'
import { build } from '../scripts/build-sprites'

const reg = buildRegistry()

describe('arte do poker', () => {
  it('todo quadro tem as dimensões esperadas e linhas do mesmo tamanho', () => {
    for (const [name, s] of Object.entries(reg.sprites)) {
      const want = expectedSize(name)
      expect(want, name).not.toBeNull()
      expect(s.length, `${name} altura`).toBe(want![1])
      for (const line of s) expect(line.length, `${name} largura`).toBe(want![0])
    }
  })

  it('só usa chaves da paleta', () => {
    for (const [name, s] of Object.entries(reg.sprites))
      for (const line of s) for (const ch of line) expect(ch === '.' || ch in PALETTE, `${name}: "${ch}"`).toBe(true)
  })

  it('tem as 52 cartas, versos, destaques, 12 quadros de timer e as poses do Jan', () => {
    for (const r of ['A', '2', '10', 'J', 'Q', 'K']) for (const s of ['c', 'd', 'h', 's']) {
      expect(reg.sprites[`card_${r}${s}`]).toBeTruthy()
      expect(reg.sprites[`card_${r}${s}_hl`]).toBeTruthy()
    }
    expect(reg.animations.timer_ring).toHaveLength(12)
    const want = { jan_shuffle: 6, jan_deal: 3, jan_clap: 4, jan_scared: 2, jan_give: 3, jan_idle: 2 }
    for (const [k, n] of Object.entries(want)) expect(reg.animations[k], k).toHaveLength(n)
    for (const names of Object.values(reg.animations)) for (const n of names) expect(reg.sprites[n]).toBeTruthy()
  })

  it('as cartas são todas diferentes', () => {
    const seen = new Set(Object.entries(reg.sprites).filter(([n]) => /^card_/.test(n)).map(([, s]) => s.join('|')))
    expect(seen.size).toBe(Object.keys(reg.sprites).filter((n) => /^card_/.test(n)).length)
  })

  it('o build gera sprites.png, sprites.json e preview.png coerentes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'janja-sprites-'))
    const out = build(dir)
    for (const f of [out.sheet, out.json, out.preview]) expect(existsSync(f)).toBe(true)
    const json = JSON.parse(readFileSync(out.json, 'utf8'))
    const png = PNG.sync.read(readFileSync(out.sheet))
    expect(json.meta.image).toBe('sprites.png')
    expect(json.meta.size).toEqual({ w: png.width, h: png.height })
    expect(Object.keys(json.frames)).toHaveLength(Object.keys(reg.sprites).length)
    for (const f of Object.values(json.frames) as { frame: { x: number; y: number; w: number; h: number } }[]) {
      expect(f.frame.x + f.frame.w).toBeLessThanOrEqual(png.width)
      expect(f.frame.y + f.frame.h).toBeLessThanOrEqual(png.height)
    }
    expect(json.animations.jan_shuffle).toHaveLength(6)
  })
})
