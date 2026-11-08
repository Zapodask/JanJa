import { describe, expect, it } from 'vitest'
import { BEACHES, BOARD_SIZE, CORNER, GROUPS, TILES, baseRent, citiesOfSide, tilesOfGroup } from '../../src/shared/games/tycoon/board'
import { apply, nextDeadline, parseAction, parseOptions, rentOf, setPresence, setup, tick, view, type TycoonState } from '../../src/shared/games/tycoon/engine'
import { AWAY_MS, JAM_FINE, ROLL_MS, SALARY, START_CASH, type TycoonAction } from '../../src/shared/games/tycoon/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const T0 = 1_000_000
const PLAYERS = [
  { playerId: 'a', name: 'Ana' },
  { playerId: 'b', name: 'Bia' },
  { playerId: 'c', name: 'Caio' }
]
/** dados combinados: cada número é a face de um dado */
const dice = (...faces: number[]): GameCtx['rng'] => ({ int: () => (faces.shift() ?? 1) - 1 })
const ctx = (rng: GameCtx['rng'] = seededRng(1), now = T0): GameCtx => ({ now, rng })

function start(n = 2, minutes: 0 | 15 = 0) {
  const s = setup(PLAYERS.slice(0, n), { minutes }, ctx()).state
  return { s, ids: s.players.map((p) => p.playerId) }
}
function act(s: TycoonState, who: string, a: TycoonAction, rng?: GameCtx['rng'], now = T0): TycoonState {
  const r = apply(s, who, a, ctx(rng, now))
  if (isGameError(r)) throw new Error(r.message)
  return r.state
}
const roll = (s: TycoonState, who: string, a: number, b: number) => act(s, who, { type: 'roll' }, dice(a, b))

describe('tabuleiro do Magnata', () => {
  it('32 casas, cantos, 8 grupos de 2 ou 3 cidades, 4 praias e cinco cidades por lado', () => {
    expect(TILES).toHaveLength(BOARD_SIZE)
    expect(TILES[CORNER.start].kind).toBe('start')
    expect(TILES[CORNER.jam].kind).toBe('jam')
    expect(TILES[CORNER.festival].kind).toBe('festival')
    expect(TILES[CORNER.airport].kind).toBe('airport')
    expect(GROUPS.map((_, g) => tilesOfGroup(g).length)).toEqual([2, 3, 2, 3, 2, 3, 2, 3])
    expect(BEACHES).toHaveLength(4)
    for (const side of [0, 1, 2, 3]) expect(citiesOfSide(side)).toHaveLength(5)
    // preço sobe ao longo da volta
    const prices = TILES.filter((t) => t.kind === 'city').map((t) => t.price as number)
    expect([...prices].sort((x, y) => x - y)).toEqual(prices)
  })
})

describe('motor do Magnata', () => {
  it('opções e ações', () => {
    expect(parseOptions(undefined)).toEqual({ minutes: 25 })
    expect(isGameError(parseOptions({ minutes: 7 }))).toBe(true)
    expect(parseAction({ type: 'buy', level: 2 })).toEqual({ type: 'buy', level: 2 })
    expect(isGameError(parseAction({ type: 'fly', tile: 40 }))).toBe(true)
  })

  it('começa com dinheiro, todos na Partida, e só quem está na vez joga', () => {
    const { s, ids } = start()
    expect(s.players.every((p) => p.cash === START_CASH && p.position === 0)).toBe(true)
    expect(view(s, ids[0], T0).pending).toEqual({ kind: 'rolar', jammed: false, fine: JAM_FINE })
    expect(isGameError(apply(s, ids[1], { type: 'roll' }, ctx()))).toBe(true)
    expect(nextDeadline(s)).toBe(T0 + ROLL_MS)
  })

  it('compra cidade já com casas, cobra aluguel e deixa tomar a cidade', () => {
    let { s, ids } = start()
    const [a, b] = ids
    s = roll(s, a, 2, 3) // Canela (5)
    const pend = view(s, a, T0).pending
    expect(pend).toMatchObject({ kind: 'comprar', tile: 5 })
    expect(pend?.kind === 'comprar' && pend.options.map((o) => o.cost)).toEqual([100, 160, 220, 280])
    s = act(s, a, { type: 'buy', level: 2 })
    expect(s.props[5]).toEqual({ owner: a, level: 2 })
    expect(s.players[0].cash).toBe(START_CASH - 220)
    expect(s.turn).toBe(1)
    // Bia cai em Canela: paga aluguel e pode tomar por 2x o investido
    s = roll(s, b, 1, 4)
    expect(s.players[1].cash).toBe(START_CASH - baseRent(5, 2))
    expect(view(s, b, T0).pending).toEqual({ kind: 'tomar', tile: 5, price: 440, owner: a })
    s = act(s, b, { type: 'takeover' })
    expect(s.props[5].owner).toBe(b)
    expect(s.players[0].cash).toBe(START_CASH - 220 + baseRent(5, 2) + 440)
    // depois de tomar, pode construir
    expect(view(s, b, T0).pending?.kind).toBe('construir')
    s = act(s, b, { type: 'build', level: 4 })
    expect(s.props[5].level).toBe(4)
  })

  it('grupo completo e festival dobram o aluguel', () => {
    const { s, ids } = start()
    s.props[1] = { owner: ids[0], level: 0 }
    expect(rentOf(s, 1)).toBe(baseRent(1, 0))
    s.props[2] = { owner: ids[0], level: 0 }
    expect(rentOf(s, 1)).toBe(baseRent(1, 0) * 2)
    s.festival = 1
    expect(rentOf(s, 1)).toBe(baseRent(1, 0) * 4)
  })

  it('dupla rola de novo; três duplas vão para o engarrafamento', () => {
    let { s, ids } = start()
    const a = ids[0]
    s = roll(s, a, 1, 1) // Tiradentes
    s = act(s, a, { type: 'pass' })
    expect(s.turn).toBe(0)
    s = roll(s, a, 2, 2) // 6 Gramado
    s = act(s, a, { type: 'pass' })
    s = roll(s, a, 3, 3)
    expect(s.players[0].position).toBe(CORNER.jam)
    expect(s.players[0].jam).toBe(3)
    expect(s.turn).toBe(1)
  })

  it('engarrafamento: sai com dupla, pagando ou depois de três tentativas', () => {
    let { s, ids } = start()
    const a = ids[0]
    s.players[0].position = CORNER.jam
    s.players[0].jam = 3
    expect(view(s, a, T0).pending).toEqual({ kind: 'rolar', jammed: true, fine: JAM_FINE })
    let t = roll(s, a, 1, 2)
    expect(t.players[0]).toMatchObject({ position: CORNER.jam, jam: 2 })
    t = act(s, a, { type: 'roll', pay: true }, dice(1, 2))
    expect(t.players[0]).toMatchObject({ position: 11, jam: 0, cash: START_CASH - JAM_FINE })
    s.players[0].jam = 1
    t = roll(s, a, 1, 2)
    expect(t.players[0]).toMatchObject({ position: 11, jam: 0, cash: START_CASH - JAM_FINE })
  })

  it('passar pela Partida paga salário', () => {
    let { s, ids } = start()
    s.players[0].position = 30
    s = roll(s, ids[0], 1, 2) // 30 + 3 = 1 (Penedo)
    expect(s.players[0].position).toBe(1)
    expect(s.players[0].cash).toBe(START_CASH + SALARY)
  })

  it('quem não paga vende cidades e, se não der, quebra (e a partida acaba)', () => {
    let { s, ids } = start()
    const [a, b] = ids
    s.props[31] = { owner: b, level: 4 } // São Paulo com hotel
    s.props[1] = { owner: a, level: 0 }
    s.players[0].cash = 10
    s.players[0].position = 28
    s = roll(s, a, 1, 2)
    expect(s.props[1]).toBeUndefined()
    expect(s.players[0].out).toBe(true)
    expect(s.result).toMatchObject({ winner: b, reason: 'falencia' })
    expect(s.result?.ranking.map((r) => r.playerId)).toEqual([b, a])
  })

  it('vitória na hora com as quatro praias', () => {
    let { s, ids } = start()
    const a = ids[0]
    for (const t of BEACHES.slice(1)) s.props[t] = { owner: a, level: 0 }
    s = roll(s, a, 1, 3) // praia 4
    s = act(s, a, { type: 'buy', level: 0 })
    expect(s.result).toMatchObject({ winner: a, reason: 'praias' })
    expect(nextDeadline(s)).toBeNull()
  })

  it('vitória com um lado inteiro', () => {
    let { s, ids } = start()
    const a = ids[0]
    for (const t of [1, 2, 5, 6]) s.props[t] = { owner: a, level: 0 }
    s = roll(s, a, 3, 4) // Petrópolis (7)
    s = act(s, a, { type: 'buy', level: 0 })
    expect(s.result).toMatchObject({ winner: a, reason: 'lado' })
  })

  it('festival e aeroporto pedem escolha de casa', () => {
    let { s, ids } = start()
    const a = ids[0]
    s.props[1] = { owner: a, level: 0 }
    s.players[0].position = 10
    s = roll(s, a, 2, 4) // 16 festival
    expect(view(s, a, T0).pending).toEqual({ kind: 'festival', tiles: [1] })
    s = act(s, a, { type: 'festival', tile: 1 })
    expect(s.festival).toBe(1)
    ;({ s } = start())
    s.players[0].position = 20
    s = roll(s, a, 1, 3) // 24 aeroporto
    expect(view(s, a, T0).pending?.kind).toBe('voar')
    s = act(s, a, { type: 'fly', tile: 2 })
    expect(s.players[0].position).toBe(2)
    expect(s.players[0].cash).toBe(START_CASH - 50 + SALARY)
  })

  it('prazo estourado: o jogo rola e passa sozinho', () => {
    let { s } = start()
    s = tick(s, ctx(dice(2, 3), T0 + ROLL_MS)).state
    expect(s.players[0].position).toBe(5)
    expect(s.phase.kind).toBe('comprar')
    s = tick(s, ctx(seededRng(1), s.until as number)).state
    expect(s.props[5]).toBeUndefined()
    expect(s.turn).toBe(1)
  })

  it('quem sai da sala joga sozinho rápido', () => {
    const { s, ids } = start()
    const t = setPresence(s, ids[0], false, ctx(seededRng(1), T0 + 100)).state
    expect(t.until).toBe(T0 + 100 + AWAY_MS)
  })

  it('fim por tempo: vence quem tem mais patrimônio', () => {
    const { s, ids } = start(3, 15)
    s.players[2].cash = 5000
    const r = tick(s, ctx(seededRng(1), T0 + 15 * 60_000))
    expect(r.state.result).toMatchObject({ winner: ids[2], reason: 'tempo' })
  })

  it('cartas Surpresa: o baralho anda e o texto vai para o histórico', () => {
    let { s, ids } = start()
    s = roll(s, ids[0], 1, 2) // casa 3, Surpresa
    expect(s.deckPos).toBe(1)
    expect(view(s, null, T0).log.some((l) => l.includes('Surpresa'))).toBe(true)
  })
})
