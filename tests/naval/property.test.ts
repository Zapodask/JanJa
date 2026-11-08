import { describe, expect, it } from 'vitest'
import { apply, nextDeadline, setup, tick, view, type NavalState } from '../../src/shared/games/naval/engine'
import { randomFleet, SIZE } from '../../src/shared/games/naval/fleet'
import { isGameError, seededRng } from '../../src/shared/games/types'

describe('batalha naval: partidas aleatórias', () => {
  for (const mode of ['classico', 'salva'] as const) {
    it(`${mode}: 40 partidas terminam com um vencedor e sem tiro repetido`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const rng = seededRng(seed)
        let now = 1_000_000
        let s: NavalState = setup(
          [
            { playerId: 'a', name: 'A' },
            { playerId: 'b', name: 'B' }
          ],
          { mode },
          { now, rng }
        ).state
        if (rng.int(2)) s = (apply(s, 'a', { type: 'place', ships: randomFleet(rng) }, { now, rng }) as { state: NavalState }).state
        for (let step = 0; step < 1000 && s.phase !== 'fim'; step++) {
          now += 500
          const d = nextDeadline(s) as number
          if (s.phase === 'posicionar' || rng.int(6) === 0) {
            now = Math.max(now, d)
            s = tick(s, { now, rng }).state
            continue
          }
          const who = s.players[s.turn].playerId
          const v = view(s, who, now)
          const used = new Set(v.seas[1 - s.turn].shots.map((c) => `${c.x},${c.y}`))
          const free: Array<{ x: number; y: number }> = []
          for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (!used.has(`${x},${y}`)) free.push({ x, y })
          const cells = Array.from({ length: v.shots }, () => free.splice(rng.int(free.length), 1)[0])
          const r = apply(s, who, { type: 'shoot', cells, ref: v.ref }, { now, rng })
          if (isGameError(r)) throw new Error(r.message)
          s = r.state
          for (const sea of s.shots) expect(new Set(sea.map((c) => `${c.x},${c.y}`)).size).toBe(sea.length)
        }
        expect(s.phase).toBe('fim')
        expect(view(s, null, now).seas[1 - (s.winner as number)].afloat).toBe(0)
      }
    })
  }
})
