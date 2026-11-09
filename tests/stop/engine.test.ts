import { describe, expect, it } from 'vitest'
import { LETTERS, normalize, startsWith } from '../../src/shared/games/stop/categories'
import { apply, nextDeadline, parseOptions, setPresence, setup, tick, view, type StopState } from '../../src/shared/games/stop/engine'
import { GRACE_MS, REVIEW_MS, SCORES_MS, type StopAction } from '../../src/shared/games/stop/types'
import { isGameError, seededRng, type GameCtx } from '../../src/shared/games/types'

const T0 = 1_000_000
const ctx = (now = T0): GameCtx => ({ now, rng: seededRng(9) })
const PLAYERS = ['Ana', 'Bia', 'Caio'].map((name, i) => ({ playerId: `p${i}`, name }))
const CATS = ['nome', 'animal', 'cor']

/** partida com letra combinada (B) e 3 categorias */
function game(rounds: 3 | 5 = 3, seconds: 0 | 60 = 60): StopState {
  const s = setup(PLAYERS, { categories: CATS, rounds, seconds }, ctx()).state
  s.letter = 'B'
  return s
}
function act(s: StopState, p: string, a: StopAction, now = T0): StopState {
  const r = apply(s, p, a, ctx(now))
  if (isGameError(r)) throw new Error(r.message)
  return r.state
}
/** escreve, para e chega na conferência */
function toReview(s: StopState, answers: Record<string, Record<string, string>>): StopState {
  for (const [p, a] of Object.entries(answers)) s = act(s, p, { type: 'write', round: s.round, answers: a })
  const full = Object.entries(answers).find(([, a]) => CATS.every((c) => a[c]))
  if (full) s = act(s, full[0], { type: 'stop', round: s.round, answers: full[1] })
  else s = tick(s, ctx(T0 + 60_000)).state
  return tick(s, ctx((s.until as number) + 1)).state
}

describe('Stop', () => {
  it('texto: sem acento e sem diferença de maiúscula; letra com acento vale', () => {
    expect(normalize('  São   Paulo ')).toBe('sao paulo')
    expect(startsWith('Ágata', 'A')).toBe(true)
    expect(startsWith('Érica', 'e')).toBe(true)
    expect(startsWith('Bola', 'C')).toBe(false)
    expect(LETTERS).not.toContain('K')
  })

  it('opções: pelo menos 3 categorias conhecidas', () => {
    expect(isGameError(parseOptions({ categories: ['nome', 'cor'] }))).toBe(true)
    expect(isGameError(parseOptions({ categories: ['nome', 'cor', 'xyz'] }))).toBe(true)
    expect(parseOptions({ categories: ['cor', 'nome', 'animal'], rounds: 3, seconds: 0 })).toEqual({ categories: ['nome', 'animal', 'cor'], rounds: 3, seconds: 0 })
  })

  it('enquanto escrevem, ninguém vê as respostas dos outros (só quantas preencheu)', () => {
    let s = game()
    s = act(s, 'p0', { type: 'write', round: 1, answers: { nome: 'Benedito', animal: 'Baleia' } })
    const v = view(s, 'p1', T0)
    expect(v.players[0].filled).toBe(2)
    expect(v.review).toBeNull()
    expect(JSON.stringify(v)).not.toContain('Benedito')
    expect(JSON.stringify(v)).not.toContain('Baleia')
    expect(view(s, 'p0', T0).myAnswers).toEqual({ nome: 'Benedito', animal: 'Baleia' })
  })

  it('STOP só com tudo preenchido com a letra; depois tem 3 s de folga', () => {
    let s = game()
    const r = apply(s, 'p0', { type: 'stop', round: 1, answers: { nome: 'Bruno', animal: 'Gato', cor: 'Branco' } }, ctx())
    expect(isGameError(r) && r.message).toContain('Animal')
    s = act(s, 'p0', { type: 'stop', round: 1, answers: { nome: 'Bruno', animal: 'Baleia', cor: 'Branco' } })
    expect(s.phase).toBe('parando')
    expect(nextDeadline(s)).toBe(T0 + GRACE_MS)
    // a Bia ainda manda o que estava escrevendo
    s = act(s, 'p1', { type: 'write', round: 1, answers: { nome: 'Bia' } }, T0 + 1000)
    s = tick(s, ctx(T0 + GRACE_MS)).state
    expect(s.phase).toBe('conferindo')
    expect(isGameError(apply(s, 'p2', { type: 'write', round: 1, answers: { nome: 'Beto' } }, ctx()))).toBe(true)
    expect(view(s, 'p2', T0).review?.nome.map((e) => e.answer)).toEqual(['Bruno', 'Bia', ''])
  })

  it('pontos: 10 única, 5 repetida (sem acento), 0 vazia ou com outra letra', () => {
    let s = game()
    s = toReview(s, {
      p0: { nome: 'Bruno', animal: 'Baleia', cor: 'Branco' },
      p1: { nome: 'bruno', animal: 'Búfalo', cor: 'Azul' },
      p2: { nome: 'Beatriz', animal: '' }
    })
    for (const p of ['p0', 'p1', 'p2']) s = act(s, p, { type: 'ready', round: 1 })
    expect(s.history[0].points).toEqual({ p0: 5 + 10 + 10, p1: 5 + 10 + 0, p2: 10 })
    expect(s.phase).toBe('placar')
  })

  it('"não vale" com a maioria dos outros derruba a resposta; ninguém vota na própria', () => {
    let s = game()
    s = toReview(s, { p0: { nome: 'Bruno', animal: 'Bolacha', cor: 'Branco' }, p1: { nome: 'Bia' } })
    expect(isGameError(apply(s, 'p0', { type: 'vote', round: 1, target: 'p0', category: 'animal', invalid: true }, ctx()))).toBe(true)
    s = act(s, 'p1', { type: 'vote', round: 1, target: 'p0', category: 'animal', invalid: true })
    expect(view(s, 'p2', T0).review?.animal[0]).toMatchObject({ votes: 1, invalid: false }) // 1 de 2 não é maioria
    s = act(s, 'p2', { type: 'vote', round: 1, target: 'p0', category: 'animal', invalid: true })
    expect(view(s, 'p2', T0).review?.animal[0]).toMatchObject({ votes: 2, invalid: true, mine: true })
    // desmarcar volta
    s = act(s, 'p2', { type: 'vote', round: 1, target: 'p0', category: 'animal', invalid: false })
    expect(view(s, 'p0', T0).review?.animal[0].invalid).toBe(false)
  })

  it('tempo da rodada acaba sozinho; conferência fecha no prazo; placar puxa a próxima letra', () => {
    let s = game()
    expect(nextDeadline(s)).toBe(T0 + 60_000)
    s = tick(s, ctx(T0 + 60_000)).state
    expect(s.phase).toBe('parando')
    s = tick(s, ctx(T0 + 60_000 + GRACE_MS)).state
    expect(s.phase).toBe('conferindo')
    s = tick(s, ctx(T0 + 60_000 + GRACE_MS + REVIEW_MS)).state
    expect(s.phase).toBe('placar')
    s = tick(s, ctx((s.until as number) + SCORES_MS)).state
    expect(s.round).toBe(2)
    expect(s.letter).not.toBe(s.used[0])
    expect(s.phase).toBe('escrevendo')
  })

  it('ação de rodada velha é recusada; quem sai da sala não segura a conferência', () => {
    let s = game()
    expect(isGameError(apply(s, 'p0', { type: 'write', round: 0, answers: {} }, ctx()))).toBe(true)
    s = toReview(s, { p0: { nome: 'Bruno', animal: 'Baleia', cor: 'Branco' } })
    s = act(s, 'p0', { type: 'ready', round: 1 })
    s = act(s, 'p1', { type: 'ready', round: 1 })
    expect(s.phase).toBe('conferindo')
    s = setPresence(s, 'p2', false, ctx()).state
    expect(s.phase).toBe('placar')
  })

  it('a partida acaba depois da última rodada, com ranking', () => {
    let s = game(3, 0)
    expect(nextDeadline(s)).toBeNull() // sem tempo: só para no STOP
    for (let r = 1; r <= 3; r++) {
      s.letter = 'B'
      s = toReview(s, { p0: { nome: 'Bruno', animal: 'Baleia', cor: 'Branco' } })
      for (const p of ['p0', 'p1', 'p2']) s = act(s, p, { type: 'ready', round: r })
      if (r < 3) s = tick(s, ctx((s.until as number) + 1)).state
    }
    expect(s.phase).toBe('fim')
    expect(view(s, null, T0).ranking?.[0]).toEqual({ playerId: 'p0', total: 90, place: 1 })
    expect(view(s, null, T0).ranking?.[1].place).toBe(2)
  })
})
