import { describe, expect, it } from 'vitest'
import { apply, autoShot, setup, type PoolState } from '../../src/shared/games/pool/engine'
import { canPlace, R } from '../../src/shared/games/pool/physics'
import { HEAD_X } from '../../src/shared/games/pool/rules'
import { isGameError, seededRng } from '../../src/shared/games/types'

/** Partidas inteiras com tacadas "quase certas" e força variada: as regras nunca quebram a mesa. */
describe('sinuca: partidas aleatórias', () => {
  it('40 partidas terminam, sempre com 16 bolas e sem bolas sobrepostas', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = seededRng(seed)
      let now = 1_000_000
      let s: PoolState = setup(
        [
          { playerId: 'a', name: 'A' },
          { playerId: 'b', name: 'B' }
        ],
        {},
        { now, rng }
      ).state
      let shots = 0
      while (s.winner === null && shots < 600) {
        now += 1000
        const base = autoShot(s)
        const noise = (rng.int(200) - 100) / 400
        const a = { ...base, dx: base.dx - base.dy * noise, dy: base.dy + base.dx * noise, power: 0.2 + rng.int(80) / 100 }
        if (s.ballInHand && rng.int(2) === 0) {
          const x = R + 1 + rng.int(90)
          const y = R + 1 + rng.int(45)
          if (canPlace(s.balls, x, y, s.broken ? undefined : HEAD_X)) Object.assign(a, { cue: { x, y } })
        }
        const r = apply(s, s.players[s.turn].playerId, a, { now, rng })
        if (isGameError(r)) throw new Error(`${r.message} ${JSON.stringify(a)}`)
        s = r.state
        shots++
        expect(s.balls).toHaveLength(16)
        if (s.winner === null) expect(s.balls.find((b) => b.id === 0)?.in).toBe(false)
        const on = s.balls.filter((b) => !b.in)
        for (let i = 0; i < on.length; i++)
          for (let j = i + 1; j < on.length; j++) expect(Math.hypot(on[i].x - on[j].x, on[i].y - on[j].y)).toBeGreaterThan(2 * R - 0.05)
      }
      expect(s.winner).not.toBeNull()
    }
  })
})
