import { describe, expect, it } from 'vitest'
import { gameReducer, initialGameState, meOf } from '../src/web/game/state'
import {
  wantsGameMusic,
  actionButtons,
  cardName,
  describeForScreenReader,
  duckFromLevel,
  formatClock,
  handsTable,
  sameRects,
  sfxForEvent,
  shortcutAction,
  shouldInvite,
  trackForEvent
} from '../src/web/game/helpers'
import type { LegalAction, PokerView } from '../src/shared/games/poker/types'
import type { GameLobby } from '../src/shared/games/protocol'

const lobby = (over: Partial<GameLobby> = {}): GameLobby => ({
  gameId: 'poker',
  options: { mode: 'holdem', minutes: 30, buy: 'recompra' },
  openedBy: 'Pedro',
  canManage: true,
  seats: [
    { seat: 0, playerId: 'p0', name: 'Pedro', present: true, you: true },
    { seat: 1, playerId: 'p1', name: 'Bia', present: true, you: false }
  ],
  maxPlayers: 8,
  minPlayers: 2,
  started: false,
  ...over
})

const view = (over: Partial<PokerView> = {}): PokerView =>
  ({
    mode: 'holdem',
    options: { mode: 'holdem', minutes: 30, buy: 'recompra' },
    phase: 'flop',
    handNo: 1,
    endsAt: null,
    seats: [{ playerId: 'p0', name: 'Pedro' }, { playerId: 'p1', name: 'Bia' }],
    board: ['As', 'Kd', '7c'],
    pots: [],
    toAct: 'p0',
    actDeadline: null,
    legal: [{ kind: 'fold' }, { kind: 'call', amount: 10 }, { kind: 'raise', amount: 20, to: 20 }],
    you: { playerId: 'p0', hand: ['Ah', 'Ks'], best: { category: 2, name: 'Dois pares, Ases e Reis', cards: [] }, draws: [] },
    showdown: null,
    ranking: null,
    ...over
  }) as unknown as PokerView

describe('estado do jogo (reducer)', () => {
  it('guarda o lobby e descobre meu playerId pela cadeira "você"', () => {
    const s = gameReducer(initialGameState, { type: 'game-lobby', lobby: lobby() })
    expect(s.lobby?.openedBy).toBe('Pedro')
    expect(s.me).toBe('p0')
  })
  it('lobby nulo limpa a partida', () => {
    let s = gameReducer(initialGameState, { type: 'game-lobby', lobby: lobby({ started: true }) })
    s = gameReducer(s, { type: 'game-view', seq: 3, view: view() })
    expect(s.view).not.toBeNull()
    s = gameReducer(s, { type: 'game-lobby', lobby: null })
    expect(s.view).toBeNull()
    expect(s.viewSeq).toBe(-1)
    expect(s.me).toBeNull()
  })
  it('a visão guarda o seq e ignora visão antiga', () => {
    let s = gameReducer(initialGameState, { type: 'game-lobby', lobby: lobby({ started: true }) })
    s = gameReducer(s, { type: 'game-view', seq: 5, view: view({ handNo: 5 }) })
    const velha = gameReducer(s, { type: 'game-view', seq: 4, view: view({ handNo: 4 }) })
    expect((velha.view as PokerView | null)?.handNo).toBe(5)
    expect(velha.viewSeq).toBe(5)
  })
  it('eventos ficam em lastEvents com o seq', () => {
    const s = gameReducer(initialGameState, { type: 'game-events', seq: 2, events: [{ kind: 'shuffle', handNo: 1 }] })
    expect(s.lastEvents).toEqual({ seq: 2, events: [{ kind: 'shuffle', handNo: 1 }] })
  })
  it('mesa nova não iniciada esquece a visão anterior; iniciada mantém', () => {
    let s = gameReducer(initialGameState, { type: 'game-lobby', lobby: lobby({ started: true }) })
    s = gameReducer(s, { type: 'game-view', seq: 2, view: view() })
    expect(gameReducer(s, { type: 'game-lobby', lobby: lobby({ started: true }) }).view).not.toBeNull()
    expect(gameReducer(s, { type: 'game-lobby', lobby: lobby({ started: false }) }).view).toBeNull()
  })
  it('reset volta ao inicial e meOf cai na visão privada', () => {
    expect(gameReducer(initialGameState, { type: 'reset' })).toEqual(initialGameState)
    expect(meOf(null, view())).toBe('p0')
  })
})

describe('botões e atalhos', () => {
  const legal: LegalAction[] = [{ kind: 'raise', amount: 20, to: 20 }, { kind: 'fold' }, { kind: 'call', amount: 10 }, { kind: 'allin', amount: 35 }]
  it('rótulos claros com os valores, na ordem da tela', () => {
    expect(actionButtons(legal).map((b) => b.label)).toEqual(['Desistir', 'Pagar 10', 'Aumentar para 20', 'Tudo (35)'])
  })
  it('sem aposta na mesa, o aumento vira "Apostar"', () => {
    const l: LegalAction[] = [{ kind: 'check' }, { kind: 'raise', amount: 10, to: 10 }, { kind: 'fold' }]
    expect(actionButtons(l).map((b) => b.label)).toEqual(['Desistir', 'Passar', 'Apostar 10'])
  })
  it('P é passar ou pagar, A aumenta (ou vai de tudo), D desiste', () => {
    expect(shortcutAction('p', legal)).toEqual({ kind: 'call' })
    expect(shortcutAction('P', [{ kind: 'check' }, { kind: 'fold' }])).toEqual({ kind: 'check' })
    expect(shortcutAction('a', legal)).toEqual({ kind: 'raise' })
    expect(shortcutAction('a', [{ kind: 'allin', amount: 5 }, { kind: 'fold' }])).toEqual({ kind: 'allin' })
    expect(shortcutAction('d', legal)).toEqual({ kind: 'fold' })
    expect(shortcutAction('x', legal)).toBeNull()
    expect(shortcutAction('p', [])).toBeNull()
  })
})

describe('eventos para som e música', () => {
  it('mapeia cada evento para um efeito', () => {
    expect(sfxForEvent({ kind: 'shuffle', handNo: 1 })).toEqual({ name: 'shuffle' })
    expect(sfxForEvent({ kind: 'deal', to: ['a', 'b'], count: 2 })).toEqual({ name: 'deal', count: 4 })
    expect(sfxForEvent({ kind: 'street', street: 'flop', cards: ['As', 'Kd', '7c'] })).toEqual({ name: 'flip', count: 3 })
    expect(sfxForEvent({ kind: 'street', street: 'river', cards: ['2c'] })).toEqual({ name: 'turn' })
    expect(sfxForEvent({ kind: 'act', by: 'a', action: 'check', amount: 0 })).toEqual({ name: 'check' })
    expect(sfxForEvent({ kind: 'act', by: 'a', action: 'fold', amount: 0 })).toEqual({ name: 'fold' })
    expect(sfxForEvent({ kind: 'act', by: 'a', action: 'allin', amount: 90 })).toEqual({ name: 'allin' })
    expect(sfxForEvent({ kind: 'act', by: 'a', action: 'raise', amount: 40 })).toEqual({ name: 'chip', count: 2 })
    expect(sfxForEvent({ kind: 'win', by: 'a', amount: 40, potIndex: 0 })).toEqual({ name: 'win' })
    expect(sfxForEvent({ kind: 'end', ranking: [] })).toEqual({ name: 'podium' })
    expect(sfxForEvent({ kind: 'away', by: 'a', away: true })).toBeNull()
  })
  it('all-in tensiona, fim vence, mão nova acalma', () => {
    expect(trackForEvent({ kind: 'act', by: 'a', action: 'allin', amount: 9 })).toBe('tensao')
    expect(trackForEvent({ kind: 'end', ranking: [] })).toBe('vitoria')
    expect(trackForEvent({ kind: 'shuffle', handNo: 2 })).toBe('calma')
    expect(trackForEvent({ kind: 'act', by: 'a', action: 'call', amount: 9 })).toBeNull()
  })
  it('o ducking sobe com a voz e fica em 0..1', () => {
    expect(duckFromLevel(0)).toBe(0)
    expect(duckFromLevel(0.5)).toBe(1)
    expect(duckFromLevel(0.1)).toBeGreaterThan(0)
  })
})

describe('textos e convite', () => {
  it('relógio e nome de carta', () => {
    expect(formatClock(125_000)).toBe('2:05')
    expect(formatClock(-5)).toBe('0:00')
    expect(cardName('As')).toBe('Ás de espadas')
  })
  it('a tabela muda no modo de 3 cartas', () => {
    expect(handsTable('holdem')).toHaveLength(10)
    expect(handsTable('tres').map((h) => h.name)).toEqual(['Straight flush', 'Trinca', 'Sequência', 'Flush', 'Par', 'Carta alta'])
  })
  it('texto para leitor de tela cita a mão, a mesa e as ações', () => {
    const t = describeForScreenReader(view(), 'p0')
    expect(t).toContain('Sua mão: Ás de copas, Rei de espadas.')
    expect(t).toContain('Sua vez.')
    expect(t).toContain('Pagar 10')
  })
  it('o convite some para quem abriu, quem sentou e quem dispensou', () => {
    const l = { started: false, openedBy: 'Pedro' }
    expect(shouldInvite(l, false, 'Bia', null)).toBe(true)
    expect(shouldInvite(l, true, 'Bia', null)).toBe(false)
    expect(shouldInvite(l, false, 'Pedro', null)).toBe(false)
    expect(shouldInvite(l, false, 'Bia', 'Pedro')).toBe(false)
    expect(shouldInvite({ ...l, started: true }, false, 'Bia', null)).toBe(false)
    expect(shouldInvite(null, false, 'Bia', null)).toBe(false)
  })
  it('compara retângulos', () => {
    const r = { x: 1, y: 2, w: 3, h: 4 }
    expect(sameRects([r], [{ ...r }])).toBe(true)
    expect(sameRects([r], [{ ...r, w: 5 }])).toBe(false)
    expect(sameRects([r], [])).toBe(false)
  })
})

describe('música da partida', () => {
  const base = { seated: false, watching: false, started: true, musicOn: true }
  it('toca para quem joga e para quem assiste com a mesa aberta', () => {
    expect(wantsGameMusic({ ...base, seated: true })).toBe(true)
    expect(wantsGameMusic({ ...base, watching: true })).toBe(true)
  })
  it('não toca para quem só está na sala, antes de começar ou com a música desligada', () => {
    expect(wantsGameMusic(base)).toBe(false)
    expect(wantsGameMusic({ ...base, watching: true, started: false })).toBe(false)
    expect(wantsGameMusic({ ...base, watching: true, musicOn: false })).toBe(false)
  })
})
