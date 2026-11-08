import type { GameDefinition } from '../types'
import { apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type CheckersState } from './engine'
import type { CheckersAction, CheckersEvent, CheckersOptions, CheckersView } from './types'

export const checkersGame: GameDefinition<CheckersState, CheckersOptions, CheckersAction, CheckersView, CheckersEvent> = {
  id: 'checkers',
  name: 'Damas',
  minPlayers: 2,
  maxPlayers: 2,
  parseOptions,
  setup: (players, options, ctx) => setup(players, options, ctx),
  parseAction,
  apply,
  tick,
  nextDeadline,
  setPresence,
  view,
  isOver
}

export type { CheckersState } from './engine'
