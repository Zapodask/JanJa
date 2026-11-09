import { checkersGame } from './checkers'
import { chessGame } from './chess'
import { golfGame } from './golf'
import { mysteryGame } from './mystery'
import { navalGame } from './naval'
import { pokerGame } from './poker'
import { poolGame } from './pool'
import { shooterGame } from './shooter'
import { stopGame } from './stop'
import { trucoGame } from './truco'
import { tycoonGame } from './tycoon'
import type { GameId } from './protocol'
import type { AnyGame } from './types'

/** Partial: os testes do GameHost registram só um jogo-teste. */
export type GameRegistry = Partial<Record<GameId, AnyGame>>

/** Jogos disponíveis na sala. O highcard (jogo-teste) fica só nos testes do GameHost. */
export const GAMES: GameRegistry = {
  poker: pokerGame,
  golf: golfGame,
  chess: chessGame,
  checkers: checkersGame,
  tycoon: tycoonGame,
  truco: trucoGame,
  shooter: shooterGame,
  naval: navalGame,
  mystery: mysteryGame,
  pool: poolGame,
  stop: stopGame
}
