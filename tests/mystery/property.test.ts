import { describe, expect, it } from 'vitest'
import { botAction } from '../../src/shared/games/mystery/bot'
import { apply, nextDeadline, setup, tick, view, type MysteryState } from '../../src/shared/games/mystery/engine'
import { isGameError, seededRng } from '../../src/shared/games/types'

describe('Mistério: partidas inteiras com bots', () => {
  it('60 partidas de 2 a 6 terminam e quem acusa sabendo acerta', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const n = 2 + (seed % 5)
      const rng = seededRng(seed)
      let now = 1_000_000
      let s: MysteryState = setup(
        Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` })),
        {},
        { now, rng }
      ).state
      for (let step = 0; step < 2000 && s.phase !== 'fim'; step++) {
        now += 1000
        if (rng.int(20) === 0) {
          now = Math.max(now, nextDeadline(s) as number)
          s = tick(s, { now, rng }).state
          continue
        }
        const acted = s.players.some((p) => {
          const a = botAction(view(s, p.playerId, now), rng)
          if (!a) return false
          const r = apply(s, p.playerId, a, { now, rng })
          if (isGameError(r)) throw new Error(`${r.message} ${JSON.stringify(a)}`)
          s = r.state
          return true
        })
        expect(acted).toBe(true)
      }
      expect(s.phase).toBe('fim')
      // bot que só acusa com certeza nunca erra
      expect(s.accusations.every((a) => a.correct)).toBe(true)
    }
  })
})
