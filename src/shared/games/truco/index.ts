import type { GameDefinition } from '../types'
import { apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type TrucoState } from './engine'
import type { TrucoAction, TrucoEvent, TrucoOptions, TrucoView } from './types'

export const trucoGame: GameDefinition<TrucoState, TrucoOptions, TrucoAction, TrucoView, TrucoEvent> = {
  id: 'truco',
  name: 'Truco',
  minPlayers: 2,
  maxPlayers: 6,
  // na testa (3x3) os três duelos correm juntos; cada ação traz a versão da mesa (`ref`)
  concurrent: true,
  seats: (o) => ({ min: o.players, max: o.players }),
  parseOptions,
  setup,
  parseAction,
  apply,
  tick,
  nextDeadline,
  setPresence,
  view,
  isOver
}

export type { TrucoState } from './engine'
