/**
 * Pontos de carga lazy dos jogos: Pixi, GSAP, Three.js, os tabuleiros (xadrez, damas, Magnata) e o áudio só entram no bundle quando um jogo abre.
 */
import type { CheckersSceneProps, ChessSceneProps, GameAudio, GolfSceneProps, PokerSceneProps, TycoonSceneProps } from './contract'
import type { ShooterSceneProps } from './shooter/contract'
import type { ComponentType } from 'react'

export const loadScene = (): Promise<{ default: ComponentType<PokerSceneProps> }> =>
  import('./scene').then((m) => ({ default: m.PokerScene }))

/** cena 3D do golfe: o Three.js só entra neste pedaço */
export const loadGolfScene = (): Promise<{ default: ComponentType<GolfSceneProps> }> =>
  import('./golf/scene').then((m) => ({ default: m.GolfScene }))

/** tabuleiro do xadrez (SVG, sem biblioteca de desenho) */
export const loadChessScene = (): Promise<{ default: ComponentType<ChessSceneProps> }> =>
  import('./chess/scene').then((m) => ({ default: m.ChessScene }))

/** tabuleiro das damas (SVG, sem biblioteca de desenho) */
export const loadCheckersScene = (): Promise<{ default: ComponentType<CheckersSceneProps> }> =>
  import('./checkers/scene').then((m) => ({ default: m.CheckersScene }))

/** tabuleiro do Magnata (HTML e SVG, sem biblioteca de desenho) */
export const loadTycoonScene = (): Promise<{ default: ComponentType<TycoonSceneProps> }> =>
  import('./tycoon/scene').then((m) => ({ default: m.TycoonScene }))

/** cena do Tiro na Sala (Pixi, em pixel art 480x270): o Pixi só entra neste pedaço */
export const loadShooterScene = (): Promise<{ default: ComponentType<ShooterSceneProps> }> =>
  import('./shooter/scene').then((m) => ({ default: m.ShooterScene }))

export const loadAudio = (): Promise<() => GameAudio> => import('./audio').then((m) => () => m.createGameAudio())
