/**
 * Pontos de carga lazy dos jogos: Pixi, GSAP, Three.js, os tabuleiros (xadrez, damas, Magnata), a mesa do truco, a batalha naval, o Mistério, a sinuca, o Stop e o áudio só entram no bundle quando um jogo abre.
 */
import type { ShooterSceneProps } from './shooter/contract'
import type { CheckersSceneProps, ChessSceneProps, GameAudio, GolfSceneProps, MysterySceneProps, NavalSceneProps, PokerSceneProps, PoolSceneProps, StopSceneProps, TrucoSceneProps, TycoonSceneProps } from './contract'
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
/** mesa do truco (HTML e SVG, sem biblioteca de desenho) */
export const loadTrucoScene = (): Promise<{ default: ComponentType<TrucoSceneProps> }> =>
  import('./truco/scene').then((m) => ({ default: m.TrucoScene }))

/** batalha naval (SVG, sem biblioteca de desenho) */
export const loadNavalScene = (): Promise<{ default: ComponentType<NavalSceneProps> }> =>
  import('./naval/scene').then((m) => ({ default: m.NavalScene }))

/** Mistério (HTML e SVG, sem biblioteca de desenho) */
export const loadMysteryScene = (): Promise<{ default: ComponentType<MysterySceneProps> }> =>
  import('./mystery/scene').then((m) => ({ default: m.MysteryScene }))

/** mesa da sinuca (canvas 2D, sem biblioteca de desenho) */
export const loadPoolScene = (): Promise<{ default: ComponentType<PoolSceneProps> }> =>
  import('./pool/scene').then((m) => ({ default: m.PoolScene }))

/** Stop (só HTML) */
export const loadStopScene = (): Promise<{ default: ComponentType<StopSceneProps> }> =>
  import('./stop/scene').then((m) => ({ default: m.StopScene }))

export const loadAudio = (): Promise<() => GameAudio> => import('./audio').then((m) => () => m.createGameAudio())
