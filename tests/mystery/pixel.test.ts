import { describe, expect, it } from 'vitest'
import { PLACES, SUSPECTS, TOOLS } from '../../src/shared/games/mystery/cards'
import { ICONS, PAL, portrait, runs } from '../../src/web/game/mystery/scene/pixel'

describe('pixel art do Mistério', () => {
  it('um retrato 12x12 diferente para cada suspeito', () => {
    const all = SUSPECTS.map((s) => portrait(s.id))
    for (const p of all) {
      expect(p).toHaveLength(12)
      for (const row of p) expect(row).toHaveLength(12)
      for (const ch of p.join('')) if (ch !== '.' && ch !== 'c') expect(PAL[ch], ch).toBeDefined()
    }
    expect(new Set(all.map((p) => p.join('/'))).size).toBe(SUSPECTS.length)
  })

  it('um ícone 9x9 para cada lugar e objeto', () => {
    for (const c of [...PLACES, ...TOOLS]) {
      const icon = ICONS[c.id]
      expect(icon, c.id).toBeDefined()
      expect(icon).toHaveLength(9)
      for (const row of icon) expect(row, `${c.id}: ${row}`).toHaveLength(9)
      for (const ch of icon.join('')) if (ch !== '.') expect(PAL[ch], `${c.id}: ${ch}`).toBeDefined()
      expect(runs(icon).reduce((a, r) => a + r.w, 0)).toBe(icon.join('').replace(/\./g, '').length)
    }
  })
})
