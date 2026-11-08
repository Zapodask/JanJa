import type { GameDefinition } from '../types'
import { apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type MysteryState } from './engine'
import type { MysteryAction, MysteryEvent, MysteryOptions, MysteryView } from './types'

export const mysteryGame: GameDefinition<MysteryState, MysteryOptions, MysteryAction, MysteryView, MysteryEvent> = {
  id: 'mystery',
  name: 'Mistério',
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

export type { MysteryState } from './engine'
