import { describe, expect, it } from 'vitest'
import { DISC_PALETTE, DISC_SIZE, DISCS, discRuns } from '../../src/web/game/checkers/scene/pieces'

describe('peças das damas em pixel art', () => {
  it('discos 16x16, só com letras da paleta, e a dama tem coroa', () => {
    for (const rows of [DISCS.man, DISCS.king]) {
      expect(rows).toHaveLength(DISC_SIZE)
      for (const row of rows) {
        expect(row).toHaveLength(DISC_SIZE)
        for (const ch of row) if (ch !== '.') expect(DISC_PALETTE.w[ch]).toBeDefined()
      }
    }
    expect(DISCS.man.join('')).not.toContain('y')
    expect(DISCS.king.join('')).toContain('y')
  })

  it('as tiras cobrem os pixels pintados', () => {
    const filled = DISCS.king.join('').replace(/\./g, '').length
    expect(discRuns('B').reduce((a, r) => a + r.w, 0)).toBe(filled)
  })
})
