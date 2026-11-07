/// <reference types="vite/client" />
import '@fontsource-variable/archivo/wdth.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

// Rotas de laboratório (/dev/poker, /dev/audio): só em dev; o ramo some do build de produção, junto com o Pixi.
if (import.meta.env.DEV) {
  void import('./game/dev/routes').then(async ({ DEV_ROUTES }) => {
    const route = DEV_ROUTES.find((r) => r.path === location.pathname)
    if (route) {
      const Page = (await route.load()).default
      root.render(<Page />)
    } else root.render(<App />)
  })
} else {
  // Sem StrictMode de propósito: o duplo mount em dev abriria duas conexões com a sala.
  root.render(<App />)
}
