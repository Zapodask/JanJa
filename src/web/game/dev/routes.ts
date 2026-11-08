/**
 * Rotas de desenvolvimento do jogo (só valem com `import.meta.env.DEV`; nunca entram no build de produção
 * se o chamador as proteger com essa condição, como no exemplo).
 *
 *   if (import.meta.env.DEV) {
 *     const route = DEV_ROUTES.find((r) => r.path === location.pathname)
 *     if (route) { const Page = lazy(route.load); ... }
 *   }
 *
 * Laboratórios: /dev/audio, /dev/poker (SceneLab), /dev/golf (GolfLab, o motor do golfe rodando local)
 * /dev/chess (ChessLab) e /dev/checkers (CheckersLab): xadrez e damas locais, com um bot de lances aleatórios;
 * /dev/tycoon (TycoonLab): o Magnata com até 5 bots.
 */
import type { ComponentType } from 'react'

export interface DevRoute {
  path: string
  load: () => Promise<{ default: ComponentType }>
}

export const DEV_ROUTES: DevRoute[] = [
  { path: '/dev/audio', load: () => import('./AudioLab') },
  { path: '/dev/poker', load: () => import('./SceneLab').then((m) => ({ default: m.SceneLab })) },
  { path: '/dev/golf', load: () => import('./GolfLab').then((m) => ({ default: m.GolfLab })) },
  { path: '/dev/chess', load: () => import('./ChessLab').then((m) => ({ default: m.ChessLab })) },
  { path: '/dev/checkers', load: () => import('./CheckersLab').then((m) => ({ default: m.CheckersLab })) },
  { path: '/dev/tycoon', load: () => import('./TycoonLab').then((m) => ({ default: m.TycoonLab })) }
]
