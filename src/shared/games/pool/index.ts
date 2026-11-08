import type { GameDefinition } from '../types'
import { apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type PoolState } from './engine'
import type { PoolAction, PoolEvent, PoolOptions, PoolView } from './types'

export const poolGame: GameDefinition<PoolState, PoolOptions, PoolAction, PoolView, PoolEvent> = {
  id: 'pool',
  name: 'Sinuca',
  minPlayers: 2,
  maxPlayers: 2,
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

export type { PoolState } from './engine'
