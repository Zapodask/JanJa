import type { PokerEvent, PokerView } from '../../shared/games/poker/types'
import type { GameLobby } from '../../shared/games/protocol'
import type { ServerMessage } from '../../shared/protocol'
import type { GameClientState } from './contract'

/** Estado do jogo no cliente + o seq da última visão (a ação precisa do seq atual do servidor). */
export interface GameState extends GameClientState {
  viewSeq: number
}

export const initialGameState: GameState = { lobby: null, view: null, lastEvents: null, me: null, viewSeq: -1 }

export type GameMsg = Extract<ServerMessage, { type: 'game-lobby' | 'game-view' | 'game-events' }>
export type GameAction = GameMsg | { type: 'reset' }

export const isGameMsg = (m: ServerMessage): m is GameMsg =>
  m.type === 'game-lobby' || m.type === 'game-view' || m.type === 'game-events'

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null

/** Meu playerId: pela cadeira marcada como "você" no lobby, ou pela visão privada. */
export function meOf(lobby: GameLobby | null, view: PokerView | null): string | null {
  return lobby?.seats.find((s) => s.you)?.playerId ?? view?.you?.playerId ?? null
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'reset':
      return initialGameState
    case 'game-lobby': {
      const lobby = action.lobby
      // sem jogo aberto, ou mesa nova ainda não iniciada: esquece a partida anterior
      if (!lobby || !lobby.started) {
        return { lobby, view: null, lastEvents: null, viewSeq: -1, me: meOf(lobby, null) }
      }
      return { ...state, lobby, me: meOf(lobby, state.view) }
    }
    case 'game-view': {
      if (action.seq < state.viewSeq || !isObject(action.view)) return state
      const view = action.view as unknown as PokerView
      return { ...state, view, viewSeq: action.seq, me: meOf(state.lobby, view) }
    }
    case 'game-events':
      return { ...state, lastEvents: { seq: action.seq, events: action.events as PokerEvent[] } }
  }
}
