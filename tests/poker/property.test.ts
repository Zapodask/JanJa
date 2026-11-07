import { describe, expect, it } from 'vitest'
import { Hand } from 'pokersolver'
import { pokerGame, type PokerState } from '../../src/shared/games/poker'
import { TABLE, type PokerEvent, type PokerOptions } from '../../src/shared/games/poker/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const CARD_RE = /"([2-9TJQKA][cdhs])"/g

/** gabarito de pote/side pots: descasca camadas de contribuição (algoritmo diferente do motor) */
function oracle(opts: {
  contrib: number[]
  folded: boolean[]
  score: (i: number) => unknown // força comparável via compare()
  compare: (a: number, b: number) => number
  dealer: number
}): number[] {
  const n = opts.contrib.length
  const rem = opts.contrib.slice()
  const pay = new Array<number>(n).fill(0)
  const live = opts.folded.map((f) => !f)
  if (live.filter(Boolean).length === 1) {
    pay[live.indexOf(true)] = rem.reduce((s, x) => s + x, 0)
    return pay
  }
  let carry = 0
  for (;;) {
    const active = rem.map((r, i) => (r > 0 ? i : -1)).filter((i) => i >= 0)
    if (!active.length) break
    const m = Math.min(...active.map((i) => rem[i]))
    const amount = m * active.length + carry
    carry = 0
    for (const i of active) rem[i] -= m
    const contenders = active.filter((i) => live[i])
    if (!contenders.length) { carry = amount; continue }
    let winners = [contenders[0]]
    for (const i of contenders.slice(1)) {
      const c = opts.compare(i, winners[0])
      if (c > 0) winners = [i]
      else if (c === 0) winners.push(i)
    }
    winners.sort((a, b) => ((a - opts.dealer - 1 + n) % n) - ((b - opts.dealer - 1 + n) % n))
    const share = Math.floor(amount / winners.length)
    const odd = amount - share * winners.length
    winners.forEach((w, k) => { pay[w] += share + (k < odd ? 1 : 0) })
  }
  if (carry) throw new Error('dinheiro morto sem dono ' + JSON.stringify(opts))
  return pay
}

function runGame(seed: number, handsBudget: { left: number }, stats: Record<string, number>): void {
  const rng = seededRng(seed)
  const pick = (n: number) => rng.int(n)
  const n = 2 + pick(7)
  const options: PokerOptions = {
    mode: pick(4) === 0 ? 'tres' : 'holdem',
    minutes: ([0, 0, 0, 15, 30] as const)[pick(5)],
    buy: pick(3) === 0 ? 'torneio' : 'recompra'
  }
  let now = 1_000_000 * (1 + pick(5))
  const players = Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, name: `N${i}` }))
  const ctx = (): GameCtx => ({ now, rng })
  const first = pokerGame.setup(players, options, ctx())
  let state: PokerState = first.state
  let events: PokerEvent[] = first.events
  // estacas desiguais (rigging na mão 1; a conferência de pote começa na mão 2)
  const rigged = pick(2) === 0
  let skipHand = 0
  if (rigged) {
    state = structuredClone(state)
    for (const p of state.players) if (p.status === 'jogando') p.stack = 1 + pick(400)
    skipHand = 1
  }
  const baseline = state.players.reduce((s, p) => s + p.stack + p.contrib, 0) - TABLE.startStack * state.players.reduce((s, p) => s + p.rebuys, 0)

  let handEvents: PokerEvent[] = [...first.events]
  let stackStart: number[] = state.players.map((p) => p.stack + p.contrib)
  let checkedHand = 0
  let hands = 1
  let prev: PokerState = state
  const absorb = (evs: PokerEvent[], before: PokerState, after: PokerState) => {
    for (const e of evs) {
      if (e.kind === 'shuffle') {
        handEvents = []
        stackStart = before.players.map((p) => p.stack)
        hands++
        handsBudget.left--
      }
      handEvents.push(e)
    }
    if (evs.some((e) => e.kind === 'shuffle')) {
      for (const e of evs) if (e.kind === 'rebuy') stackStart[after.players.findIndex((p) => p.playerId === e.by)] += e.amount
    }
    if (after.showdown && after.handNo > checkedHand && (after.phase === 'intervalo' || after.phase === 'fim')) {
      checkedHand = after.handNo
      if (after.handNo > skipHand) checkPayout(after)
      stats.hands++
      if (after.showdown.winners.some((w) => w.hand)) stats.showdowns++
      if (handEvents.filter((e) => e.kind === 'win').length > 1) stats.multiWin++
      if (handEvents.some((e) => e.kind === 'win' && e.potIndex > 0)) stats.sidePots++
    }
  }
  const checkPayout = (after: PokerState) => {
    const k = after.players.length
    const contrib = new Array<number>(k).fill(0)
    for (const e of handEvents) {
      const i = after.players.findIndex((p) => p.playerId === (e as { by?: string }).by)
      if (e.kind === 'blind' || e.kind === 'ante' || e.kind === 'act') contrib[i] += e.amount
    }
    const dealt = after.players.map((p) => p.hole.length > 0 && handEvents.some((e) => e.kind === 'deal' && e.to.includes(p.playerId)))
    const folded = after.players.map((p, i) => !dealt[i] || p.status === 'desistiu')
    const solve = (i: number) =>
      options.mode === 'tres' ? Hand.solve(after.players[i].hole, 'threecard') : Hand.solve([...after.players[i].hole, ...after.board])
    const hs: unknown[] = after.players.map((_, i) => (folded[i] ? null : solve(i)))
    const compare = (a: number, b: number) => {
      const w = Hand.winners([hs[a], hs[b]])
      return w.length === 2 ? 0 : w[0] === hs[a] ? 1 : -1
    }
    const pay = oracle({ contrib, folded, score: () => 0, compare, dealer: after.dealer })
    after.players.forEach((p, i) => {
      expect(p.stack, `seed ${seed} mão ${after.handNo} jogador ${i}`).toBe(stackStart[i] - contrib[i] + pay[i])
    })
  }

  const checkInvariants = (s: PokerState) => {
    // fichas
    const tot = s.players.reduce((a, p) => a + p.stack + p.contrib, 0) - TABLE.startStack * s.players.reduce((a, p) => a + p.rebuys, 0)
    expect(tot).toBe(baseline)
    for (const p of s.players) expect(p.stack).toBeGreaterThanOrEqual(0)
    // cartas únicas e completas
    const all = [...s.deck, ...s.board, ...s.players.flatMap((p) => p.hole)]
    expect(new Set(all).size).toBe(all.length)
    // 0 cartas só quando a mesa está esperando gente voltar (ou terminou assim)
    expect(all.length === 52 || (all.length === 0 && s.actor < 0)).toBe(true)
    // quem está em jogo e age tem ficha
    if (s.actor >= 0) {
      expect(s.players[s.actor].status).toBe('jogando')
      expect(s.players[s.actor].stack).toBeGreaterThan(0)
      const v = pokerGame.view(s, s.players[s.actor].playerId, now)
      expect(v.legal.length).toBeGreaterThan(0)
      expect(v.legal.some((l) => l.kind === 'check' || l.kind === 'fold')).toBe(true)
      expect(pokerGame.nextDeadline(s)).toBe(v.actDeadline)
      expect(v.toAct).toBe(s.players[s.actor].playerId)
    }
    // visão: nenhuma carta fora do permitido
    for (const viewer of [null, ...s.players.map((p) => p.playerId)]) {
      const v = pokerGame.view(s, viewer, now)
      const allowed = new Set<string>(s.board)
      s.players.forEach((p) => { if (p.playerId === viewer || p.shown) p.hole.forEach((c) => allowed.add(c)) })
      const waiting = s.deck.length === 0
      for (const w of s.showdown?.winners ?? []) {
        for (const c of w.hand?.cards ?? []) {
          // cartas de mão vencedora já foram reveladas no showdown
          if (waiting) allowed.add(c)
          else expect(allowed.has(c), `showdown revelou ${c} indevidamente`).toBe(true)
        }
      }
      const json = JSON.stringify(v)
      for (const m of json.matchAll(CARD_RE)) expect(allowed.has(m[1]), `vazou ${m[1]} para ${viewer}`).toBe(true)
      expect(json).not.toContain('deck')
      // cartas reveladas só de quem chegou ao showdown
      for (const sv of v.seats) if (sv.playerId !== viewer && sv.cards) {
        const p = s.players.find((q) => q.playerId === sv.playerId)!
        expect(p.status === 'desistiu').toBe(false)
        expect(p.shown).toBe(true)
      }
      expect(v.pots.reduce((a, pt) => a + pt.amount, 0)).toBeLessThanOrEqual(s.players.reduce((a, p) => a + p.contrib, 0))
    }
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  }

  let steps = 0
  let lastHandNo = 0
  let stepsInHand = 0
  while (state.phase !== 'fim' && hands < 25 && handsBudget.left > 0) {
    if (++steps > 20_000) throw new Error(`seed ${seed}: partida não avança`)
    if (state.handNo !== lastHandNo) { lastHandNo = state.handNo; stepsInHand = 0 }
    if (++stepsInHand > 400) throw new Error(`seed ${seed}: mão não termina`)
    checkInvariants(state)
    prev = state
    const d = pokerGame.nextDeadline(state)
    let res: { state: PokerState; events: PokerEvent[] }
    if (state.actor >= 0) {
      const id = state.players[state.actor].playerId
      if (d !== null && now >= d) {
        res = pokerGame.tick(state, ctx()); stats.timeouts++
      } else if (pick(100) < 6) {
        // vira timeout
        now = d as number
        res = pokerGame.tick(state, ctx()); stats.timeouts++
      } else if (pick(100) < 3) {
        const q = state.players[pick(n)]
        res = pokerGame.setPresence(state, q.playerId, !q.present, ctx())
      } else {
        const legal = pokerGame.view(state, id, now).legal
        const w = legal.map((l) => (l.kind === 'fold' ? 1 : l.kind === 'raise' ? 5 : l.kind === 'allin' ? 4 : 4))
        let r = pick(w.reduce((a, b) => a + b, 0))
        let k = 0
        while (r >= w[k]) { r -= w[k]; k++ }
        const a = legal[k]
        const out = pokerGame.apply(state, id, { kind: a.kind }, ctx())
        if (isGameError(out)) throw new Error(`ação legal recusada: ${a.kind} ${out.message}`)
        res = out
        stats[a.kind] = (stats[a.kind] ?? 0) + 1
        now += pick(4000)
      }
    } else {
      // intervalo
      if (d === null) {
        // esperando: todos voltam
        const away = state.players.find((p) => !p.present)
        if (!away) throw new Error(`seed ${seed}: parado sem ninguém ausente (fase ${state.phase})`)
        res = pokerGame.setPresence(state, away.playerId, true, ctx())
        stats.waits++
      } else {
        now = Math.max(now, d)
        res = pokerGame.tick(state, ctx())
      }
    }
    absorb(res.events, prev, res.state)
    state = res.state
    events = res.events
  }
  checkInvariants(state)
  void events
}

describe('propriedades (partidas aleatórias com ações legais)', () => {
  it('2.000 mãos: fichas, cartas, visões, potes (gabarito pokersolver) e progresso', () => {
    const stats: Record<string, number> = { hands: 0, showdowns: 0, multiWin: 0, sidePots: 0, timeouts: 0, waits: 0 }
    const budget = { left: 2000 }
    let seed = 1
    while (budget.left > 0) runGame(seed++, budget, stats)
    console.log('estatísticas', JSON.stringify(stats), 'partidas', seed - 1)
    expect(stats.hands).toBeGreaterThanOrEqual(1900)
    expect(stats.showdowns).toBeGreaterThan(300)
    expect(stats.sidePots).toBeGreaterThan(20)
    expect(stats.timeouts).toBeGreaterThan(50)
  }, 600_000)
})
