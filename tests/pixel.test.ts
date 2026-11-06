import { describe, expect, it } from 'vitest'
import { PALETTE, POSES, SIZE, TV_FRAMES } from '../src/web/ui/pixelData'

const all = [
  ...Object.entries(POSES).flatMap(([name, def]) => def.frames.map((f, i) => ({ id: `${name}[${i}]`, f }))),
  ...TV_FRAMES.map((f, i) => ({ id: `tv[${i}]`, f }))
]

describe('sprites pixel', () => {
  it.each(all)('$id tem 24 linhas de 24 caracteres só com chaves da paleta', ({ f }) => {
    expect(f).toHaveLength(SIZE)
    for (const line of f) {
      expect(line).toHaveLength(SIZE)
      for (const ch of line) expect(ch === '.' || ch in PALETTE).toBe(true)
    }
  })

  it('cada quadro de Jan tem pixels desenhados', () => {
    for (const { id, f } of all) expect(f.join('').replace(/\./g, '').length, id).toBeGreaterThan(20)
  })

  it('as sequências só apontam para quadros que existem', () => {
    for (const [name, def] of Object.entries(POSES))
      for (const i of def.seq) expect(def.frames[i], `${name} ${i}`).toBeDefined()
  })
})
