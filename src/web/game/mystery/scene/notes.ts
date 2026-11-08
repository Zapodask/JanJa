/**
 * Caderno de anotações do Mistério (puro, testável).
 * O jogo marca sozinho o que dá para saber pela visão:
 *  - as suas cartas (e que você não tem as outras);
 *  - a carta que mostraram para você;
 *  - quem ficou entre o palpite e quem mostrou não tem nenhuma das três (ou todos, se ninguém mostrou);
 *  - quem tem uma carta exclui todos os outros.
 * O resto a pessoa marca à mão: vazio, "não tem", "tem", "talvez".
 */
import { ALL_CARDS } from '../../../../shared/games/mystery/cards'
import type { MysteryView } from '../../../../shared/games/mystery/types'

export type Mark = '' | 'nao' | 'tem' | 'talvez'
export type Marks = Record<string, Record<number, Mark>>

export const CYCLE: Mark[] = ['', 'nao', 'tem', 'talvez']
export const nextMark = (m: Mark): Mark => CYCLE[(CYCLE.indexOf(m) + 1) % CYCLE.length]

export function autoMarks(v: MysteryView): Marks {
  const out: Marks = {}
  const set = (card: string, p: number, m: Mark) => {
    out[card] ??= {}
    // "tem" vence "não tem"
    if (out[card][p] !== 'tem') out[card][p] = m
  }
  const me = v.you?.index
  if (me === undefined) return out
  const n = v.players.length
  for (const c of ALL_CARDS) set(c.id, me, v.myCards.includes(c.id) ? 'tem' : 'nao')
  for (const h of v.history) {
    if (h.card && h.shownBy !== null && h.by === me) set(h.card, h.shownBy, 'tem')
    // quem foi pulado não tem nenhuma das três
    const stop = h.shownBy ?? h.by
    for (let k = 1; k < n; k++) {
      const p = (h.by + k) % n
      if (p === stop) break
      for (const c of [h.quem, h.onde, h.como]) set(c, p, 'nao')
    }
  }
  // cada carta está com uma pessoa só: quem tem exclui os outros
  for (const row of Object.values(out)) {
    const owner = Object.entries(row).find(([, m]) => m === 'tem')
    if (owner) for (let p = 0; p < n; p++) if (String(p) !== owner[0]) row[p] = 'nao'
  }
  return out
}

/** carta já descartada: alguém tem (então não está no envelope) */
export const ruledOut = (marks: Marks, card: string): boolean => Object.values(marks[card] ?? {}).includes('tem')

/** se todo mundo não tem, a carta está no envelope */
export function inEnvelope(marks: Marks, card: string, players: number): boolean {
  const row = marks[card] ?? {}
  return Array.from({ length: players }, (_, p) => row[p]).every((m) => m === 'nao')
}

/** junta o automático com o que a pessoa marcou (o automático manda) */
export function merge(auto: Marks, manual: Marks): Marks {
  const out: Marks = {}
  for (const c of ALL_CARDS) out[c.id] = { ...(manual[c.id] ?? {}), ...(auto[c.id] ?? {}) }
  return out
}
