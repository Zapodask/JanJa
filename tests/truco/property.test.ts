import { describe, expect, it } from 'vitest'
import { apply, nextDeadline, setup, tick, view, type TrucoState } from '../../src/shared/games/truco/engine'
import type { TrucoAction, TrucoPlayers } from '../../src/shared/games/truco/types'
import { isGameError, seededRng } from '../../src/shared/games/types'

/** Partidas inteiras com jogadas aleatórias (só as que o jogo oferece): as regras nunca quebram. */
function simulate(seed: number, n: TrucoPlayers) {
  const rng = seededRng(seed)
  const ids = Array.from({ length: n }, (_, i) => `p${i}`)
  let now = 1_000_000
  let s: TrucoState = setup(
    ids.map((id) => ({ playerId: id, name: id })),
    { players: n },
    { now, rng }
  ).state
  let prev = [0, 0]
  let testas = 0
  for (let step = 0; step < 20_000 && s.phase !== 'fim'; step++) {
    now += 200
    const d = nextDeadline(s)
    expect(d).not.toBeNull()
    if ((d !== null && now >= d) || rng.int(25) === 0) {
      if (d !== null && now < d) now = d
      s = tick(s, { now, rng }).state
    } else {
      const options: Array<{ id: string; a: TrucoAction }> = []
      for (const id of ids) {
        const v = view(s, id, now)
        const c = v.can
        const m = v.mesas.find((x) => x.id === v.myMesa)
        if (!c || !m) continue
        const ref = m.ref
        if (c.play) for (const card of v.myCards) options.push({ id, a: { type: 'play', card, ref } })
        if (c.truco !== null) options.push({ id, a: { type: 'truco', ref } })
        for (const kind of c.envido) options.push({ id, a: { type: 'envido', kind, ref } })
        if (c.quero) options.push({ id, a: { type: 'quero', ref } })
        if (c.naoquero) options.push({ id, a: { type: 'naoquero', ref } })
        if (c.contraflor) options.push({ id, a: { type: 'contraflor', ref } })
        if (c.mazo && rng.int(8) === 0) options.push({ id, a: { type: 'mazo', ref } })
      }
      if (!options.length) continue
      const o = options[rng.int(options.length)]
      const r = apply(s, o.id, o.a, { now, rng })
      if (isGameError(r)) throw new Error(`${r.message} ${JSON.stringify(o)}`)
      s = r.state
    }
    if (s.testa) testas++
    // invariantes
    const inHand = Object.values(s.cards).flat()
    const played = s.mesas.flatMap((m) => m.tricks.flatMap((t) => t.plays.map((x) => x.card)))
    expect(new Set([...inHand, ...played]).size).toBe(inHand.length + played.length)
    expect(s.score[0]).toBeGreaterThanOrEqual(prev[0])
    expect(s.score[1]).toBeGreaterThanOrEqual(prev[1])
    prev = [...s.score]
    if (s.phase === 'jogando') for (const m of s.mesas) if (m.winner === null) expect(m.until).not.toBeNull()
    if (s.testa) expect(s.mesas).toHaveLength(3)
  }
  return { s, testas }
}

describe('truco: partidas aleatórias', () => {
  for (const n of [2, 4, 6] as const) {
    it(`${n / 2}x${n / 2}: 15 partidas chegam a 30 sem quebrar regra`, () => {
      let testas = 0
      for (let seed = 1; seed <= 15; seed++) {
        const r = simulate(seed * 7 + n, n)
        expect(r.s.phase).toBe('fim')
        expect(Math.max(...r.s.score)).toBeGreaterThanOrEqual(30)
        testas += r.testas
      }
      if (n === 6) expect(testas).toBeGreaterThan(0)
    })
  }
})
