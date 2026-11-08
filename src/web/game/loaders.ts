/**
 * Pontos de carga lazy dos jogos: Pixi, GSAP, Three.js, o tabuleiro do xadrez e o áudio só entram no bundle quando um jogo abre.
 */
import type { ChessSceneProps, GameAudio, GolfSceneProps, PokerSceneProps } from './contract'
import type { ComponentType } from 'react'

export const loadScene = (): Promise<{ default: ComponentType<PokerSceneProps> }> =>
  import('./scene').then((m) => ({ default: m.PokerScene }))

/** cena 3D do golfe: o Three.js só entra neste pedaço */
export const loadGolfScene = (): Promise<{ default: ComponentType<GolfSceneProps> }> =>
  import('./golf/scene').then((m) => ({ default: m.GolfScene }))

/** tabuleiro do xadrez (SVG, sem biblioteca de desenho) */
export const loadChessScene = (): Promise<{ default: ComponentType<ChessSceneProps> }> =>
  import('./chess/scene').then((m) => ({ default: m.ChessScene }))

export const loadAudio = (): Promise<() => GameAudio> => import('./audio').then((m) => () => m.createGameAudio())
