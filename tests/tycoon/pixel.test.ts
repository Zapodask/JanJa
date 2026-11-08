import { describe, expect, it } from 'vitest'
import { dieFace, HOTEL, HOUSE, ICONS, PAL, PAWN, PLAYER_COLORS, runs } from '../../src/web/game/tycoon/scene/pixel'

const square = (s: string[], n: number) => s.length === n && s.every((r) => r.length === n)

describe('pixel art do Magnata', () => {
  it('sprites com o tamanho certo e só letras conhecidas', () => {
    expect(square(PAWN, 10)).toBe(true)
    expect(square(HOUSE, 5)).toBe(true)
    expect(HOTEL.every((r) => r.length === 7)).toBe(true)
    for (const icon of Object.values(ICONS)) expect(square(icon, 9)).toBe(true)
    for (const s of [PAWN, HOUSE, HOTEL, ...Object.values(ICONS)])
      for (const ch of s.join('')) if (!'.ch'.includes(ch)) expect(PAL[ch], ch).toBeDefined()
  })

  it('dados de 1 a 6 com o número certo de pintas', () => {
    for (let n = 1; n <= 6; n++) {
      const f = dieFace(n)
      expect(square(f, 9)).toBe(true)
      // pintas = 'k' fora da borda
      const pips = f.slice(1, 8).map((r) => r.slice(1, 8)).join('').split('k').length - 1
      expect(pips).toBe(n)
    }
  })

  it('seis cores de jogador, todas diferentes', () => {
    expect(new Set(PLAYER_COLORS.map((c) => c.toLowerCase())).size).toBe(6)
  })

  it('tiras cobrem os pixels pintados e o peão usa a cor do jogador', () => {
    const r = runs(PAWN, '#123456')
    expect(r.reduce((a, x) => a + x.w, 0)).toBe(PAWN.join('').replace(/\./g, '').length)
    expect(r.some((x) => x.fill === '#123456')).toBe(true)
  })
})
