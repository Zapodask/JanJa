import { describe, expect, it } from 'vitest'
import { ballFill, ballGrid, BALL_PX } from '../../src/web/game/pool/scene/sprites'

describe('bolas em pixel art', () => {
  it('disco 9x9 com contorno; listradas têm faixa branca, lisas não', () => {
    for (let id = 0; id <= 15; id++) {
      const g = ballGrid(id)
      expect(g).toHaveLength(BALL_PX)
      for (const r of g) expect(r).toHaveLength(BALL_PX)
      expect(g.join('')).toContain('k')
      expect(g.join('').includes('w')).toBe(id >= 9)
    }
  })

  it('cada bola tem a sua cor; a 9 repete a cor da 1', () => {
    const fills = Array.from({ length: 16 }, (_, id) => ballFill(id, 'c'))
    expect(new Set(fills.slice(0, 9)).size).toBe(9)
    expect(fills[9]).toBe(fills[1])
    expect(fills[15]).toBe(fills[7])
  })
})
