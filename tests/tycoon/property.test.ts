import { describe, expect, it } from 'vitest'
import { BOARD_SIZE } from '../../src/shared/games/tycoon/board'
import { apply, nextDeadline, setPresence, setup, tick, view, type TycoonState } from '../../src/shared/games/tycoon/engine'
import type { TycoonAction } from '../../src/shared/games/tycoon/types'
import { isGameError, seededRng } from '../../src/shared/games/types'

/** Partidas inteiras com jogadores aleatórios: as regras nunca podem quebrar o estado. */
function simulate(seed: number, n: number) {
  const rng = seededRng(seed)
  const players = Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` }))
  let now = 1_000_000
  let s: TycoonState = setup(players, { minutes: 15 }, { now, rng }).state
  for (let step = 0; step < 5000 && !s.result; step++) {
    now += 1 + rng.int(3000)
    const d = nextDeadline(s)
    expect(d).not.toBeNull()
    if (d !== null && now >= d) {
      s = tick(s, { now, rng }).state
    } else if (rng.int(10) === 0) {
      const p = s.players[rng.int(n)]
      s = setPresence(s, p.playerId, rng.int(2) === 0, { now, rng }).state
    } else {
      const v = view(s, null, now)
      const who = v.turn as string
      const pend = v.pending
      let a: TycoonAction = { type: 'pass' }
      if (pend?.kind === 'rolar') a = { type: 'roll', ...(pend.jammed && rng.int(2) === 0 ? { pay: true } : {}) }
      else if (pend?.kind === 'comprar' && rng.int(4) > 0) a = { type: 'buy', level: pend.options[rng.int(pend.options.length)].level }
      else if (pend?.kind === 'construir' && pend.options.length && rng.int(2) === 0) a = { type: 'build', level: pend.options[rng.int(pend.options.length)].level }
      else if (pend?.kind === 'tomar' && rng.int(2) === 0) a = { type: 'takeover' }
      else if (pend?.kind === 'festival' && pend.tiles.length) a = { type: 'festival', tile: pend.tiles[rng.int(pend.tiles.length)] }
      else if (pend?.kind === 'voar' && rng.int(2) === 0) a = { type: 'fly', tile: pend.tiles[rng.int(pend.tiles.length)] }
      const r = apply(s, who, a, { now, rng })
      if (isGameError(r) && a.type === 'roll' && a.pay) continue // sem dinheiro para a multa
      if (isGameError(r)) throw new Error(`${r.message} (${JSON.stringify(a)} em ${JSON.stringify(s.phase)})`)
      s = r.state
    }
    // invariantes
    for (const p of s.players) {
      expect(p.cash).toBeGreaterThanOrEqual(0)
      expect(p.position).toBeGreaterThanOrEqual(0)
      expect(p.position).toBeLessThan(BOARD_SIZE)
    }
    for (const prop of Object.values(s.props)) expect(s.players.find((p) => p.playerId === prop.owner)?.out).toBe(false)
    if (!s.result) {
      expect(s.players[s.turn].out).toBe(false)
      expect(s.until).toBeGreaterThan(now - 1)
    }
  }
  return s
}

describe('Magnata: partidas aleatórias', () => {
  it('60 partidas terminam sem quebrar nenhuma regra', () => {
    const reasons: Record<string, number> = {}
    for (let seed = 1; seed <= 60; seed++) {
      const s = simulate(seed, 2 + (seed % 5))
      expect(s.result).not.toBeNull()
      reasons[s.result!.reason] = (reasons[s.result!.reason] ?? 0) + 1
      expect(s.result!.ranking).toHaveLength(s.players.length)
    }
    // o jogo acaba de vários jeitos, não só no tempo
    expect(Object.keys(reasons).length).toBeGreaterThan(2)
  })
})
