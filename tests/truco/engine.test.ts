import { describe, expect, it } from 'vitest'
import { apply, handWinner, nextDeadline, parseOptions, setPresence, setup, tick, view, withHands, type TrucoState } from '../../src/shared/games/truco/engine'
import { AWAY_MS, DECIDE_MS, type TrucoAction, type TrucoIntent } from '../../src/shared/games/truco/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const T0 = 1_000_000
const ctx = (now = T0): GameCtx => ({ now, rng: seededRng(5) })
const NAMES = ['Ana', 'Beto', 'Cris', 'Duda', 'Edu', 'Fê']
const players = (n: number) => NAMES.slice(0, n).map((name, i) => ({ playerId: `p${i}`, name }))

/** mesa com `n` jogadores; quem dá é o último, então o jogador 0 é mão */
function table(n: number, hands: string[][]): TrucoState {
  const s = setup(players(n), { players: n as 2 | 4 | 6 }, ctx()).state
  s.dealer = n - 1
  s.score = [0, 0] // a mão sorteada no setup pode ter dado ponto de flor
  return withHands(s, hands, T0)
}

function act(s: TrucoState, p: number, a: TrucoIntent & { ref?: number }, now = T0): TrucoState {
  const m = s.mesas.find((x) => x.order.includes(p))!
  const r = apply(s, `p${p}`, { ...a, ref: a.ref ?? m.ref } as TrucoAction, ctx(now))
  if (isGameError(r)) throw new Error(`${NAMES[p]}: ${r.message}`)
  return r.state
}
const play = (s: TrucoState, p: number, card: string) => act(s, p, { type: 'play', card })

describe('quem ganha a mão pelas vazas', () => {
  it('regras de parda', () => {
    expect(handWinner([0, 0], 1)).toBe(0)
    expect(handWinner([0, 1], 1)).toBeNull()
    expect(handWinner(['P', 1], 0)).toBe(1) // parda na primeira: decide a segunda
    expect(handWinner([0, 'P'], 1)).toBe(0) // fez a primeira e empatou a segunda
    expect(handWinner(['P', 'P'], 0)).toBeNull()
    expect(handWinner(['P', 'P', 1], 0)).toBe(1)
    expect(handWinner(['P', 'P', 'P'], 1)).toBe(1) // tudo empatado: ganha a mão
    expect(handWinner([0, 1, 'P'], 1)).toBe(0) // terceira parda: quem fez a primeira
    expect(handWinner([1, 0, 0], 1)).toBe(0)
  })
})

describe('motor do truco', () => {
  it('opções: 1x1, 2x2 ou 3x3', () => {
    expect(parseOptions(undefined)).toEqual({ players: 4 })
    expect(isGameError(parseOptions({ players: 3 }))).toBe(true)
  })

  it('cada um recebe 3 cartas e só vê as suas', () => {
    const s = setup(players(4), { players: 4 }, ctx()).state
    const all = Object.values(s.cards).flat()
    expect(all).toHaveLength(12)
    expect(new Set(all).size).toBe(12)
    const v = view(s, 'p0', T0)
    expect(v.myCards).toEqual(s.cards[0])
    const text = JSON.stringify(v)
    for (const p of [1, 2, 3]) for (const c of s.cards[p]) if (!s.cards[0].includes(c)) expect(text).not.toContain(`"${c}"`)
    expect(JSON.stringify(view(s, null, T0).myCards)).toBe('[]')
  })

  it('mão simples 1x1: quem faz duas vazas leva 1 ponto', () => {
    let s = table(2, [['1e', '3c', '4o'], ['7e', '2b', '5c']])
    expect(view(s, 'p0', T0).can?.play).toBe(true)
    expect(view(s, 'p1', T0).can?.play).toBe(false)
    s = play(s, 0, '1e')
    s = play(s, 1, '5c')
    expect(s.mesas[0].turn).toBe(0) // quem fez a vaza começa a próxima
    s = play(s, 0, '3c')
    s = play(s, 1, '2b')
    expect(s.score).toEqual([1, 0])
    expect(s.phase).toBe('intervalo')
  })

  it('truco, retruco e não quero', () => {
    let s = table(2, [['1e', '3c', '4o'], ['7e', '2b', '5c']])
    s = act(s, 0, { type: 'truco' })
    expect(view(s, 'p1', T0).can).toMatchObject({ quero: true, naoquero: true, truco: 3 })
    s = act(s, 1, { type: 'truco' }) // retruco
    expect(s.mesas[0].truco.level).toBe(2)
    expect(view(s, 'p0', T0).can).toMatchObject({ quero: true, truco: 4 })
    s = act(s, 0, { type: 'naoquero' })
    expect(s.score).toEqual([0, 2])
  })

  it('truco querido vale 2; só quem aceitou pode aumentar (retruco)', () => {
    let s = table(2, [['1e', '1b', '4o'], ['7e', '2b', '5c']])
    s = act(s, 0, { type: 'truco' })
    s = act(s, 1, { type: 'quero' })
    expect(view(s, 'p0', T0).can?.truco).toBeNull()
    s = play(s, 0, '1e')
    s = play(s, 1, '5c')
    s = play(s, 0, '1b')
    expect(view(s, 'p1', T0).can?.truco).toBe(3) // quem aceitou pode retrucar
    s = play(s, 1, '2b')
    expect(s.score).toEqual([2, 0])
  })

  it('envido querido: ganha quem tem mais; não querido vale 1', () => {
    let s = table(2, [['7e', '6e', '4o'], ['1c', '2c', '5b']]) // 33 x 23
    s = act(s, 0, { type: 'envido', kind: 'envido' })
    s = act(s, 1, { type: 'quero' })
    expect(s.score).toEqual([2, 0])
    expect(s.mesas[0].envido.result?.sung).toEqual([
      { p: 0, points: 33 },
      { p: 1, points: 23 }
    ])
    expect(view(s, 'p0', T0).can?.envido).toEqual([]) // envido só uma vez
    s = table(2, [['7e', '6e', '4o'], ['1c', '2c', '5b']])
    s = act(s, 0, { type: 'envido', kind: 'envido' })
    s = act(s, 1, { type: 'envido', kind: 'real' })
    s = act(s, 0, { type: 'naoquero' })
    expect(s.score).toEqual([0, 2])
  })

  it('falta envido vale o que falta para o líder chegar a 30; empate no envido ganha a mão', () => {
    let s = table(2, [['7e', '6e', '4o'], ['7c', '6c', '5b']]) // 33 x 33
    s.score = [12, 21]
    s = act(s, 0, { type: 'envido', kind: 'falta' })
    s = act(s, 1, { type: 'quero' })
    expect(s.score).toEqual([12 + 9, 21])
  })

  it('o envido está primeiro: trucaram na primeira vaza e ainda dá para cantar envido', () => {
    let s = table(2, [['7e', '6e', '4o'], ['1c', '2c', '5b']])
    s = act(s, 0, { type: 'truco' })
    expect(view(s, 'p1', T0).can?.envido).toEqual(['envido', 'real', 'falta'])
    s = act(s, 1, { type: 'envido', kind: 'envido' })
    expect(view(s, 'p0', T0).can).toMatchObject({ quero: true }) // o truco espera
    s = act(s, 0, { type: 'quero' })
    expect(s.score).toEqual([2, 0])
    expect(view(s, 'p1', T0).mesas[0].asking).toBe('truco')
    s = act(s, 1, { type: 'quero' })
    expect(s.mesas[0].truco.level).toBe(2)
  })

  it('flor: cantada sozinha, vale 3 e fecha o envido', () => {
    const s = table(2, [['7e', '6e', '5e'], ['1c', '2b', '5b']])
    expect(s.score).toEqual([3, 0])
    expect(view(s, 'p0', T0).can?.envido).toEqual([])
    expect(view(s, 'p1', T0).players[0].flor).toBe(true)
  })

  it('flor contra flor: contra-flor querida vale 6 para a maior', () => {
    let s = table(2, [['7e', '6e', '5e'], ['1c', '2c', '3c']]) // 38 x 26
    expect(s.score).toEqual([0, 0])
    expect(view(s, 'p1', T0).can).toMatchObject({ contraflor: true, naoquero: true })
    s = act(s, 1, { type: 'contraflor' })
    s = act(s, 0, { type: 'quero' })
    expect(s.score).toEqual([6, 0])
    // sem contra-flor: cada time leva a sua
    let t = table(2, [['7e', '6e', '5e'], ['1c', '2c', '3c']])
    t = act(t, 1, { type: 'naoquero' })
    expect(t.score).toEqual([3, 3])
  })

  it('parda na primeira: decide a segunda; quem é mão começa depois da parda', () => {
    let s = table(2, [['3e', '4o', '1e'], ['3c', '5c', '6b']])
    s = play(s, 0, '3e')
    s = play(s, 1, '3c')
    expect(s.mesas[0].tricks[0].result).toBe('P')
    expect(s.mesas[0].turn).toBe(0)
    s = play(s, 0, '4o')
    s = play(s, 1, '5c')
    expect(s.score).toEqual([0, 1])
  })

  it('ir ao baralho entrega o valor da mão', () => {
    let s = table(2, [['1e', '3c', '4o'], ['7e', '2b', '5c']])
    s = act(s, 0, { type: 'truco' })
    s = act(s, 1, { type: 'quero' })
    s = act(s, 0, { type: 'mazo' })
    expect(s.score).toEqual([0, 2])
  })

  it('2x2: a vez anda no sentido da mesa e parceiros somam no mesmo time', () => {
    let s = table(4, [['4e', '5e', '6e'.replace('6e', '6o')], ['1e', '2c', '3c'], ['4c', '5b', '6c'], ['7c', '10b', '11o']])
    expect(s.mesas[0].order).toEqual([0, 1, 2, 3])
    s = play(s, 0, '4e')
    expect(s.mesas[0].turn).toBe(1)
    s = play(s, 1, '1e')
    s = play(s, 2, '4c')
    s = play(s, 3, '7c')
    expect(s.mesas[0].tricks[0].result).toBe(1)
    expect(s.mesas[0].turn).toBe(1)
    // o parceiro (3) pode responder pelo time
    s = act(s, 1, { type: 'truco' })
    expect(view(s, 'p0', T0).can?.quero).toBe(true)
    expect(view(s, 'p2', T0).can?.quero).toBe(true)
    s = act(s, 2, { type: 'naoquero' })
    expect(s.score).toEqual([0, 1])
  })

  it('clique atrasado (versão velha da mesa) é recusado', () => {
    const s = table(2, [['1e', '3c', '4o'], ['7e', '2b', '5c']])
    const old = s.mesas[0].ref
    const s2 = act(s, 0, { type: 'truco' })
    const r = apply(s2, 'p1', { type: 'quero', ref: old }, ctx())
    expect(isGameError(r) && r.message).toContain('mudou')
  })

  it('prazo estourado: joga a carta mais fraca ou não quer', () => {
    let s = table(2, [['1e', '3c', '4o'], ['7e', '2b', '5c']])
    expect(nextDeadline(s)).toBe(T0 + DECIDE_MS)
    s = tick(s, ctx(T0 + DECIDE_MS)).state
    expect(s.mesas[0].tricks[0].plays).toEqual([{ p: 0, card: '4o' }])
    s = act(s, 1, { type: 'truco' }, T0 + DECIDE_MS)
    s = tick(s, ctx(T0 + 2 * DECIDE_MS)).state
    expect(s.score).toEqual([0, 1])
  })

  it('quem sai da sala na vez dele joga sozinho rápido', () => {
    const s = table(2, [['1e', '3c', '4o'], ['7e', '2b', '5c']])
    const t = setPresence(s, 'p0', false, ctx(T0 + 100)).state
    expect(nextDeadline(t)).toBe(T0 + 100 + AWAY_MS)
  })

  it('chegou a 30 no meio da mão: acaba na hora', () => {
    let s = table(2, [['7e', '6e', '4o'], ['1c', '2c', '5b']])
    s.score = [28, 10]
    s = act(s, 0, { type: 'envido', kind: 'envido' })
    s = act(s, 1, { type: 'quero' })
    expect(s.phase).toBe('fim')
    expect(s.winner).toBe(0)
    expect(nextDeadline(s)).toBeNull()
  })

  it('3x3: entre 5 e 25 alterna mão de testa (três duelos, cada um contra quem está na frente)', () => {
    let s = setup(players(6), { players: 6 }, ctx()).state
    expect(s.testa).toBe(false)
    s.score = [10, 12]
    s.phase = 'intervalo'
    s.until = T0
    s = tick(s, ctx(T0)).state
    expect(s.testa).toBe(true)
    expect(s.mesas.map((m) => [...m.order].sort())).toEqual([
      [0, 3],
      [1, 4],
      [2, 5]
    ])
    // os duelos são independentes: cada um joga na sua mesa
    const v = view(s, 'p1', T0)
    expect(v.myMesa).toBe(1)
    s.phase = 'intervalo'
    s.until = T0
    s = tick(s, ctx(T0)).state
    expect(s.testa).toBe(false) // alterna
    expect(s.mesas).toHaveLength(1)
  })
})
