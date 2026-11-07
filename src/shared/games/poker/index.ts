import type { GameDefinition } from '../types'
import { apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type PokerState } from './engine'
import type { PokerAction, PokerEvent, PokerOptions, PokerView } from './types'

export const pokerGame: GameDefinition<PokerState, PokerOptions, PokerAction, PokerView, PokerEvent> = {
  id: 'poker',
  name: 'Poker',
  minPlayers: 2,
  maxPlayers: 8,
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

export type { PokerState } from './engine'
