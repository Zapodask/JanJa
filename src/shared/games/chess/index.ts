import type { GameDefinition } from '../types'
import { apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type ChessState } from './engine'
import type { ChessAction, ChessEvent, ChessOptions, ChessView } from './types'

export const chessGame: GameDefinition<ChessState, ChessOptions, ChessAction, ChessView, ChessEvent> = {
  id: 'chess',
  name: 'Xadrez',
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

export type { ChessState } from './engine'
