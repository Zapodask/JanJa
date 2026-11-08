import { describe, expect, it } from 'vitest'
import { PALETTE, POSES, SIZE, TV_FRAMES } from '../src/web/ui/pixelData'
import { LOGO, LOGO_H, LOGO_PALETTE, LOGO_W } from '../src/web/ui/logo'

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

describe('logo', () => {
  it('é uma grade retangular só com cores da paleta da logo', () => {
    expect(LOGO.length).toBe(LOGO_H)
    for (const line of LOGO) {
      expect(line).toHaveLength(LOGO_W)
      for (const ch of line) expect(ch === '.' || ch in LOGO_PALETTE).toBe(true)
    }
  })

  it('tem as três camadas: letra, sombra e contorno', () => {
    const all = LOGO.join('')
    for (const ch of Object.keys(LOGO_PALETTE)) expect(all.includes(ch), ch).toBe(true)
  })

  it('o contorno fecha a logo: nenhuma letra ou sombra encosta na borda', () => {
    const edge = [LOGO[0], LOGO[LOGO_H - 1], ...LOGO.map((l) => l[0] + l[LOGO_W - 1])].join('')
    expect(edge).not.toMatch(/[yk]/)
  })
})
