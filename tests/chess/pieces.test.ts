import { describe, expect, it } from 'vitest'
import { PIECE_PALETTE, PIECE_SIZE, PIECES, pieceRuns } from '../../src/web/game/chess/scene/pieces'

describe('peças em pixel art', () => {
  it('toda peça é 16x16 e só usa letras da paleta', () => {
    for (const [type, rows] of Object.entries(PIECES)) {
      expect(rows, type).toHaveLength(PIECE_SIZE)
      for (const row of rows) {
        expect(row.length, `${type}: "${row}"`).toBe(PIECE_SIZE)
        for (const ch of row) if (ch !== '.') expect(PIECE_PALETTE.w[ch], `${type}: ${ch}`).toBeDefined()
      }
    }
  })

  it('as tiras cobrem os mesmos pixels da grade', () => {
    const runs = pieceRuns('k', 'w')
    const filled = PIECES.k.join('').replace(/\./g, '').length
    expect(runs.reduce((a, r) => a + r.w, 0)).toBe(filled)
  })
})
