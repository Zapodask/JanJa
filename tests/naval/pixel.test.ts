import { describe, expect, it } from 'vitest'
import { HIT, MISS, PAL, runs, shipSprite } from '../../src/web/game/naval/scene/pixel'

describe('pixel art da batalha naval', () => {
  it('navios de 2 a 5 casas: 8 de altura, 8 por casa, contorno e ponte', () => {
    for (let n = 2; n <= 5; n++) {
      const sp = shipSprite(n)
      expect(sp).toHaveLength(8)
      for (const row of sp) expect(row).toHaveLength(n * 8)
      const all = sp.join('')
      expect(all).toContain('k')
      expect(all).toContain('y')
      for (const ch of all) if (ch !== '.') expect(PAL[ch], ch).toBeDefined()
      // a proa afina: a ponta da direita tem menos pixels que a popa
      const col = (x: number) => sp.filter((r) => r[x] !== '.').length
      expect(col(n * 8 - 1)).toBeLessThan(col(0))
    }
  })

  it('fogo e respingo 8x8 e as tiras cobrem tudo', () => {
    for (const s of [HIT, MISS]) {
      expect(s).toHaveLength(8)
      for (const r of s) expect(r).toHaveLength(8)
      expect(runs(s).reduce((a, r) => a + r.w, 0)).toBe(s.join('').replace(/\./g, '').length)
    }
  })
})
