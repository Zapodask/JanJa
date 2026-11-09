import type { GameDefinition } from '../types'
import { apply, isOver, nextDeadline, parseAction, parseOptions, setPresence, setup, tick, view, type StopState } from './engine'
import type { StopAction, StopEvent, StopOptions, StopView } from './types'

export const stopGame: GameDefinition<StopState, StopOptions, StopAction, StopView, StopEvent> = {
  id: 'stop',
  name: 'Stop',
  minPlayers: 2,
  maxPlayers: 10,
  // todo mundo escreve ao mesmo tempo; as ações levam o número da rodada
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

export type { StopState } from './engine'
