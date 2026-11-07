/**
 * Pontos de carga lazy da mesa: Pixi, GSAP e o áudio só entram no bundle quando um jogo abre.
 */
import type { GameAudio, PokerSceneProps } from './contract'
import type { ComponentType } from 'react'

export const loadScene = (): Promise<{ default: ComponentType<PokerSceneProps> }> =>
  import('./scene').then((m) => ({ default: m.PokerScene }))

export const loadAudio = (): Promise<() => GameAudio> => import('./audio').then((m) => () => m.createGameAudio())
