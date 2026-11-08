import type { GameDefinition } from '../types'
import { apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type NavalState } from './engine'
import type { NavalAction, NavalEvent, NavalOptions, NavalView } from './types'

export const navalGame: GameDefinition<NavalState, NavalOptions, NavalAction, NavalView, NavalEvent> = {
  id: 'naval',
  name: 'Batalha naval',
  minPlayers: 2,
  maxPlayers: 2,
  // os dois posicionam ao mesmo tempo; o tiro leva o `ref` da partida
  concurrent: true,
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

export type { NavalState } from './engine'
