import type { GameDefinition } from '../types'
import { addPlayer, apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type CoordState } from './engine'
import type { ShooterAction, ShooterEvent, ShooterOptions, ShooterView } from './types'

export const shooterGame: GameDefinition<CoordState, ShooterOptions, ShooterAction, ShooterView, ShooterEvent> = {
  id: 'shooter',
  name: 'Tiro na Sala',
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
  addPlayer,
  view,
  isOver
}

export type { CoordState } from './engine'
export { sim, createSim, step, cloneState, addPlayer as addSimPlayer, setAway, movePlayer, botInput, scores, ranking, reviveState } from './sim'
