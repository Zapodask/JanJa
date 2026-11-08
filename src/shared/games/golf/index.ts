import type { GameDefinition } from '../types'
import { apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type GolfState } from './engine'
import type { GolfAction, GolfEvent, GolfOptions, GolfView } from './types'

export const golfGame: GameDefinition<GolfState, GolfOptions, GolfAction, GolfView, GolfEvent> = {
  id: 'golf',
  name: 'Golfe',
  minPlayers: 1,
  maxPlayers: 8,
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

export type { GolfState } from './engine'
