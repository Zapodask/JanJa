/**
 * Rotas de desenvolvimento do jogo (só valem com `import.meta.env.DEV`; nunca entram no build de produção
 * se o chamador as proteger com essa condição, como no exemplo).
 *
 *   if (import.meta.env.DEV) {
 *     const route = DEV_ROUTES.find((r) => r.path === location.pathname)
 *     if (route) { const Page = lazy(route.load); ... }
 *   }
 *
 * Laboratórios: /dev/audio, /dev/poker (SceneLab) e /dev/golf (GolfLab, o motor do golfe rodando local).
 */
import type { ComponentType } from 'react'

export interface DevRoute {
  path: string
  load: () => Promise<{ default: ComponentType }>
}

export const DEV_ROUTES: DevRoute[] = [
  { path: '/dev/audio', load: () => import('./AudioLab') },
  { path: '/dev/poker', load: () => import('./SceneLab').then((m) => ({ default: m.SceneLab })) },
  { path: '/dev/golf', load: () => import('./GolfLab').then((m) => ({ default: m.GolfLab })) }
]
