import { describe, expect, it } from 'vitest'
import { PAL, runs, SUIT_SPRITES } from '../../src/web/game/truco/scene/pixel'

describe('naipes em pixel art', () => {
  it('quatro naipes 9x9, só letras da paleta, e as tiras cobrem tudo', () => {
    for (const [suit, sp] of Object.entries(SUIT_SPRITES)) {
      expect(sp, suit).toHaveLength(9)
      for (const row of sp) {
        expect(row, suit).toHaveLength(9)
        for (const ch of row) if (ch !== '.') expect(PAL[ch], `${suit}: ${ch}`).toBeDefined()
      }
      expect(runs(sp).reduce((a, r) => a + r.w, 0)).toBe(sp.join('').replace(/\./g, '').length)
    }
  })
})
