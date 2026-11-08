import type { GameDefinition } from '../types'
import { apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type TycoonState } from './engine'
import type { TycoonAction, TycoonEvent, TycoonOptions, TycoonView } from './types'

export const tycoonGame: GameDefinition<TycoonState, TycoonOptions, TycoonAction, TycoonView, TycoonEvent> = {
  id: 'tycoon',
  name: 'Magnata',
  minPlayers: 2,
  maxPlayers: 6,
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

export type { TycoonState } from './engine'
