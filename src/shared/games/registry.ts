import { pokerGame } from './poker'
import type { GameId } from './protocol'
import type { AnyGame } from './types'

export type GameRegistry = Record<GameId, AnyGame>

/** Jogos disponíveis na sala. O highcard (jogo-teste) fica só nos testes do GameHost. */
export const GAMES: GameRegistry = {
  poker: pokerGame
}
