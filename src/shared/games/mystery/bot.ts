/**
 * Bot do Mistério (laboratório e testes): anota o que vê (as suas cartas e as que mostram para ele),
 * palpita entre o que falta descobrir e acusa quando sobra uma de cada.
 */
import type { Rng } from '../types'
import { PLACES, SUSPECTS, TOOLS } from './cards'
import type { MysteryAction, MysteryView } from './types'

export function botAction(v: MysteryView, rng: Rng): MysteryAction | null {
  const me = v.you?.index
  if (me === undefined) return null
  if (v.phase === 'mostrar') return v.refuter === me ? { type: 'show', card: v.myChoices[rng.int(v.myChoices.length)] } : null
  if (v.turn !== me || v.phase === 'fim') return null
  const seen = new Set([...v.myCards, ...v.history.filter((h) => h.by === me && h.card).map((h) => h.card as string)])
  const left = (cards: readonly { id: string }[]) => cards.map((c) => c.id).filter((c) => !seen.has(c))
  const [q, o, c] = [left(SUSPECTS), left(PLACES), left(TOOLS)]
  if (q.length === 1 && o.length === 1 && c.length === 1) return { type: 'accuse', quem: q[0], onde: o[0], como: c[0] }
  if (v.phase === 'palpite') return { type: 'suggest', quem: q[rng.int(q.length)], onde: o[rng.int(o.length)], como: c[rng.int(c.length)] }
  return { type: 'end' }
}
