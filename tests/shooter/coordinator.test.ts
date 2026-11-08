import { describe, expect, it } from 'vitest'
import { shooterGame } from '../../src/shared/games/shooter'
import { addPlayer, apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type CoordState } from '../../src/shared/games/shooter/engine'
import { COORD_GRACE_S, DEFAULT_SHOOTER_OPTIONS, TICK_HZ, WARMUP_TICKS, type ScoreLine, type ShooterAction, type ShooterEvent, type ShooterOptions } from '../../src/shared/games/shooter/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const T0 = 5_000_000
const ctx = (now = T0): GameCtx => ({ now, rng: seededRng(7) })
const humans = [
  { playerId: 'a', name: 'Ana' },
  { playerId: 'b', name: 'Bia' },
  { playerId: 'c', name: 'Caio' }
]
const opts = (o: Partial<ShooterOptions> = {}): ShooterOptions => ({ ...DEFAULT_SHOOTER_OPTIONS, ...o })
const line = (id: string, kills = 0, deaths = 0, damage = 0): ScoreLine => ({ id, kills, deaths, damage })

function ok<S, E>(r: { state: S; events: E[] } | { error: string; message: string }): { state: S; events: E[] } {
  if (isGameError(r)) throw new Error(r.message)
  return r as { state: S; events: E[] }
}

function start(n = 3, o: Partial<ShooterOptions> = {}): CoordState {
  return setup(humans.slice(0, n), opts(o), ctx()).state
}

describe('registro do jogo', () => {
  it('definição', () => {
    expect(shooterGame).toMatchObject({ id: 'shooter', name: 'Tiro na Sala', minPlayers: 1, maxPlayers: 8, concurrent: true })
    expect(typeof shooterGame.addPlayer).toBe('function')
  })
})

describe('opções', () => {
  it('padrões e validação', () => {
    expect(parseOptions(undefined)).toEqual(DEFAULT_SHOOTER_OPTIONS)
    expect(parseOptions({})).toEqual(DEFAULT_SHOOTER_OPTIONS)
    expect(parseOptions({ mapId: 'quintal', minutes: 8, killLimit: 30, bots: 4 })).toEqual({ mapId: 'quintal', minutes: 8, killLimit: 30, bots: 4 })
    expect(parseOptions({ bots: 2 })).toEqual({ ...DEFAULT_SHOOTER_OPTIONS, bots: 2 })
    for (const bad of [{ mapId: 'lua' }, { minutes: 4 }, { killLimit: 15 }, { bots: 5 }, { bots: -1 }, { bots: 1.5 }, { bots: '2' }, 'x', [1]]) {
      expect(isGameError(parseOptions(bad)), JSON.stringify(bad)).toBe(true)
    }
  })
})

describe('setup', () => {
  it('humanos nos slots 0..n-1, robôs no 8, host é o primeiro', () => {
    const r = setup(humans, opts({ bots: 2 }), ctx())
    const s = r.state
    expect(s.players.map((p) => [p.id, p.slot, p.bot, p.name])).toEqual([
      ['a', 0, false, 'Ana'],
      ['b', 1, false, 'Bia'],
      ['c', 2, false, 'Caio'],
      ['bot-1', 8, true, 'Robô 1'],
      ['bot-2', 9, true, 'Robô 2']
    ])
    expect(s.players.every((p) => p.present)).toBe(true)
    expect(s.hostId).toBe('a')
    expect(s.epoch).toBe(1)
    expect(s.createdAt).toBe(T0)
    expect(Number.isInteger(s.seed) && s.seed >= 0 && s.seed < 2 ** 31).toBe(true)
    expect(s.phase).toBe('jogando')
    expect(s.scores).toHaveLength(5)
    expect(s.scores.every((l) => l.kills === 0 && l.deaths === 0 && l.damage === 0)).toBe(true)
    expect(r.events).toEqual([{ type: 'host', hostId: 'a', epoch: 1 }])
    expect(isOver(s)).toBe(false)
  })

  it('mesma semente de RNG, mesma semente de jogo', () => {
    expect(start().seed).toBe(start().seed)
  })

  it('view é igual para todos; you só para quem joga', () => {
    const s = start(2, { bots: 1 })
    const va = view(s, 'a', T0)
    const vb = view(s, 'b', T0)
    expect(va.you).toEqual({ playerId: 'a', slot: 0 })
    expect(vb.you).toEqual({ playerId: 'b', slot: 1 })
    expect(view(s, null, T0).you).toBeNull()
    expect(view(s, 'bot-1', T0).you).toBeNull()
    expect({ ...va, you: null }).toEqual({ ...vb, you: null })
    expect(va.players).toHaveLength(3)
    expect(va.ranking).toBeNull()
  })
})

describe('ações', () => {
  it('parseAction valida formato', () => {
    const good = parseAction({ type: 'score', epoch: 1, scores: [line('a', 1, 2, 30)] })
    expect(good).toEqual({ type: 'score', epoch: 1, scores: [line('a', 1, 2, 30)] })
    for (const bad of [null, 3, {}, { type: 'score' }, { type: 'score', epoch: 1 }, { type: 'x', epoch: 1 }, { type: 'score', epoch: -1, scores: [] }, { type: 'score', epoch: 1, scores: [{ id: 'a', kills: 1.5, deaths: 0, damage: 0 }] }, { type: 'result', epoch: 1, ranking: [{ id: 'a', kills: -1, deaths: 0, damage: 0 }] }, { type: 'result', epoch: 1, ranking: Array.from({ length: 13 }, (_, i) => line(`x${i}`)) }]) {
      expect(isGameError(parseAction(bad)), JSON.stringify(bad)).toBe(true)
    }
  })

  it('só o host, no epoch certo', () => {
    const s = start()
    const act: ShooterAction = { type: 'score', epoch: 1, scores: [line('a', 2)] }
    const r = apply(s, 'b', act, ctx())
    expect(isGameError(r) && r.error).toBe('acao-invalida')
    expect(isGameError(apply(s, 'a', { ...act, epoch: 2 }, ctx()))).toBe(true)
    expect(isGameError(apply(s, 'zzz', act, ctx()))).toBe(true)
    const good = ok(apply(s, 'a', act, ctx()))
    expect(good.state.scores.find((l) => l.id === 'a')?.kills).toBe(2)
    expect(good.state.scores).toHaveLength(3)
    // não muta o estado anterior
    expect(s.scores.find((l) => l.id === 'a')?.kills).toBe(0)
  })

  it('placar com id desconhecido ou repetido é recusado', () => {
    const s = start()
    expect(isGameError(apply(s, 'a', { type: 'score', epoch: 1, scores: [line('fantasma')] }, ctx()))).toBe(true)
    expect(isGameError(apply(s, 'a', { type: 'score', epoch: 1, scores: [line('a'), line('a')] }, ctx()))).toBe(true)
    expect(isGameError(apply(s, 'a', { type: 'result', epoch: 1, ranking: [line('zzz')] }, ctx()))).toBe(true)
  })

  it('result encerra, guarda o ranking e avisa', () => {
    const s = start(3, { bots: 1 })
    const ranking = [line('b', 10, 3, 500), line('a', 4, 5, 200), line('bot-1', 3, 6, 100)]
    const r = ok<CoordState, ShooterEvent>(apply(s, 'a', { type: 'result', epoch: 1, ranking }, ctx(T0 + 1000)))
    expect(r.state.phase).toBe('fim')
    expect(r.state.ranking!.map((l) => l.id)).toEqual(['b', 'a', 'bot-1', 'c'])
    expect(r.events).toEqual([{ type: 'fim', ranking: r.state.ranking }])
    expect(isOver(r.state)).toBe(true)
    expect(view(r.state, 'a', 0).ranking).toHaveLength(4)
    expect(nextDeadline(r.state)).toBeNull()
    const again = apply(r.state, 'a', { type: 'score', epoch: 1, scores: [] }, ctx())
    expect(isGameError(again) && again.error).toBe('partida-encerrada')
  })
})

describe('presença e troca de host', () => {
  it('host cai: menor slot presente assume, epoch sobe', () => {
    const s = start()
    const r = ok<CoordState, ShooterEvent>(setPresence(s, 'a', false, ctx()))
    expect(r.state.hostId).toBe('b')
    expect(r.state.epoch).toBe(2)
    expect(r.events).toEqual([{ type: 'host', hostId: 'b', epoch: 2 }])
    expect(r.state.players[0].present).toBe(false)
    // ação do host antigo (epoch 1) ou do novo host com epoch velho: recusadas
    expect(isGameError(apply(r.state, 'a', { type: 'score', epoch: 1, scores: [] }, ctx()))).toBe(true)
    expect(isGameError(apply(r.state, 'b', { type: 'score', epoch: 1, scores: [] }, ctx()))).toBe(true)
    expect(isGameError(apply(r.state, 'b', { type: 'score', epoch: 2, scores: [line('b', 1)] }, ctx()))).toBe(false)
  })

  it('host antigo volta e não toma o lugar de volta', () => {
    let s = start()
    s = ok<CoordState, ShooterEvent>(setPresence(s, 'a', false, ctx())).state
    const back = ok<CoordState, ShooterEvent>(setPresence(s, 'a', true, ctx()))
    expect(back.state.hostId).toBe('b')
    expect(back.state.epoch).toBe(2)
    expect(back.events).toEqual([])
    expect(back.state.players[0].present).toBe(true)
  })

  it('quem não é host sair não muda nada; repetir presença é no-op', () => {
    const s = start()
    const r = ok<CoordState, ShooterEvent>(setPresence(s, 'c', false, ctx()))
    expect(r.state.hostId).toBe('a')
    expect(r.state.epoch).toBe(1)
    expect(r.events).toEqual([])
    const same = setPresence(r.state, 'c', false, ctx())
    expect(same.state).toBe(r.state)
    expect(setPresence(s, 'desconhecido', false, ctx()).events).toEqual([])
  })

  it('sem outro humano presente o host fica; quem volta depois assume', () => {
    let s = start(2)
    s = ok<CoordState, ShooterEvent>(setPresence(s, 'b', false, ctx())).state
    const r = ok<CoordState, ShooterEvent>(setPresence(s, 'a', false, ctx()))
    expect(r.state.hostId).toBe('a')
    expect(r.events).toEqual([])
    const back = ok<CoordState, ShooterEvent>(setPresence(r.state, 'b', true, ctx()))
    expect(back.state.hostId).toBe('b')
    expect(back.state.epoch).toBe(2)
  })

  it('robôs nunca viram host; vários trocam em cadeia', () => {
    let s = start(3, { bots: 2 })
    s = ok<CoordState, ShooterEvent>(setPresence(s, 'a', false, ctx())).state
    s = ok<CoordState, ShooterEvent>(setPresence(s, 'b', false, ctx())).state
    expect(s.hostId).toBe('c')
    expect(s.epoch).toBe(3)
    expect(setPresence(s, 'bot-1', false, ctx()).events).toEqual([])
  })
})

describe('entrar no meio', () => {
  it('ocupa o próximo slot humano livre e avisa', () => {
    const s = start(2, { bots: 1 })
    const r = ok<CoordState, ShooterEvent>(addPlayer(s, { playerId: 'z', name: 'Zeca' }, ctx()))
    expect(r.events).toEqual([{ type: 'joined', id: 'z', name: 'Zeca', slot: 2 }])
    expect(r.state.players.map((p) => p.id)).toEqual(['a', 'b', 'z', 'bot-1'])
    expect(r.state.scores.find((l) => l.id === 'z')).toEqual(line('z'))
    expect(view(r.state, 'z', 0).you).toEqual({ playerId: 'z', slot: 2 })
    expect(r.state.hostId).toBe('a')
  })

  it('reutiliza slot livre e recusa quando está cheio', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ playerId: `h${i}`, name: `H${i}` }))
    let s = setup(eight, opts({ bots: 2 }), ctx()).state
    const full = addPlayer(s, { playerId: 'x', name: 'X' }, ctx())
    expect(isGameError(full) && full.message).toBe('A partida está cheia.')
    expect(isGameError(full) && full.error).toBe('acao-invalida')
    expect(s.players).toHaveLength(10)
    s = start(2)
    s = ok<CoordState, ShooterEvent>(addPlayer(s, { playerId: 'z', name: 'Zeca' }, ctx())).state
    expect(s.players.find((p) => p.id === 'z')!.slot).toBe(2)
  })

  it('quem já estava só volta; depois do fim não entra ninguém', () => {
    let s = start(2)
    s = ok<CoordState, ShooterEvent>(setPresence(s, 'b', false, ctx())).state
    const r = ok<CoordState, ShooterEvent>(addPlayer(s, { playerId: 'b', name: 'Bia' }, ctx()))
    expect(r.state.players).toHaveLength(2)
    expect(r.state.players[1].present).toBe(true)
    const over = ok<CoordState, ShooterEvent>(apply(s, 'a', { type: 'result', epoch: 1, ranking: [line('a')] }, ctx()))
    const late = addPlayer(over.state, { playerId: 'z', name: 'Z' }, ctx())
    expect(isGameError(late) && late.error).toBe('partida-encerrada')
  })

  it('se o host está fora, quem entra vira host', () => {
    let s = start(1)
    s = ok<CoordState, ShooterEvent>(setPresence(s, 'a', false, ctx())).state
    const r = ok<CoordState, ShooterEvent>(addPlayer(s, { playerId: 'z', name: 'Zeca' }, ctx()))
    expect(r.state.hostId).toBe('z')
    expect(r.state.epoch).toBe(2)
    expect(r.events.map((e) => e.type)).toEqual(['joined', 'host'])
  })
})

describe('prazo de segurança', () => {
  it('createdAt + (min*60 + aquecimento + folga) e encerra com o último placar', () => {
    let s = start(3, { minutes: 5 })
    const due = T0 + (5 * 60 + WARMUP_TICKS / TICK_HZ + COORD_GRACE_S) * 1000
    expect(nextDeadline(s)).toBe(due)
    s = ok<CoordState, ShooterEvent>(apply(s, 'a', { type: 'score', epoch: 1, scores: [line('a', 3, 1, 90), line('b', 5, 2, 120), line('c', 5, 1, 80)] }, ctx())).state
    const early = tick(s, ctx(due - 1))
    expect(early.state.phase).toBe('jogando')
    expect(early.events).toEqual([])
    const r = tick(s, ctx(due))
    expect(r.state.phase).toBe('fim')
    expect(r.state.ranking!.map((l) => l.id)).toEqual(['c', 'b', 'a']) // abates desc, mortes asc
    expect(r.events).toEqual([{ type: 'fim', ranking: r.state.ranking }])
    expect(nextDeadline(r.state)).toBeNull()
    expect(tick(r.state, ctx(due + 1)).events).toEqual([])
  })
})
