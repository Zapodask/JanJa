import { describe, expect, it } from 'vitest'
import { buildCourse } from '../../src/shared/games/golf/course'
import { MAPS } from '../../src/shared/games/golf/maps'
import { aimEnd, buildHoleMeshes } from '../../src/web/game/golf/scene/geometry'
import { golfSfxForEvent, golfTrackForEvent } from '../../src/web/game/helpers'
import { meOf } from '../../src/web/game/state'

describe('cena do golfe (geometria pura)', () => {
  for (const m of MAPS) {
    it(`monta os buracos de ${m.name} sem números inválidos`, () => {
      for (const def of m.holes) {
        const g = buildHoleMeshes(buildCourse(def))
        for (const part of [g.floor, g.water, g.rails, g.marks]) {
          expect(part.pos.length % 9).toBe(0)
          expect(part.col.length).toBe(part.pos.length)
          expect(part.pos.every(Number.isFinite)).toBe(true)
        }
        expect(g.floor.pos.length).toBeGreaterThan(0)
      }
    })
  }

  it('a mira para na parede', () => {
    const c = buildCourse({ name: 'x', par: 2, rows: ['.....', '.O.T.', '.....'] })
    const end = aimEnd(c, 3.5, 1.5, 0, 10)
    expect(end.x).toBeLessThanOrEqual(5)
    expect(end.x).toBeGreaterThan(4.8)
    const free = aimEnd(c, 3.5, 1.5, Math.PI, 1)
    expect(free.x).toBeCloseTo(2.5, 1)
  })

  it('a mira não sobe degrau sem rampa', () => {
    const c = buildCourse({ name: 'x', par: 2, rows: ['.O.', '...', '.T.'], heights: ['111', '000', '000'] })
    const end = aimEnd(c, 1.5, 2.5, -Math.PI / 2, 5)
    expect(end.z).toBeGreaterThanOrEqual(1)
  })
})

describe('golfe na interface', () => {
  it('sons e música dos eventos', () => {
    expect(golfSfxForEvent({ type: 'shot', playerId: 'a', t0: 0, balls: [] })).toEqual({ name: 'putt' })
    expect(golfSfxForEvent({ type: 'holed', playerId: 'a', strokes: 2, par: 3 })).toBeNull()
    expect(golfTrackForEvent({ type: 'game-over', ranking: [] })).toBe('vitoria')
  })

  it('meOf acha você pela visão do golfe', () => {
    expect(meOf(null, { you: { playerId: 'p1' } })).toBe('p1')
    expect(meOf(null, { you: null })).toBeNull()
  })
})
