import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { PokerSceneProps } from '../contract'
import type { SceneEngine } from './engine'

/** Cena Pixi da mesa. O módulo do Pixi só é carregado aqui, por import dinâmico. */
export function PokerScene(props: PokerSceneProps): ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<SceneEngine | null>(null)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const el = host.current
    if (!el) return
    let dead = false
    let ro: ResizeObserver | null = null
    void import('./engine').then(async ({ SceneEngine }) => {
      if (dead) return
      const eng = new SceneEngine(el)
      engine.current = eng
      eng.setProps(latest.current)
      const fit = () => {
        const r = el.getBoundingClientRect()
        eng.resize(Math.floor(r.width), Math.floor(r.height))
      }
      ro = new ResizeObserver(fit)
      ro.observe(el)
      fit()
      await eng.init()
      if (dead) return
      eng.setProps(latest.current)
      fit()
    })
    return () => {
      dead = true
      ro?.disconnect()
      engine.current?.destroy()
      engine.current = null
      el.removeAttribute('data-scene-ready')
    }
  }, [])

  useEffect(() => {
    engine.current?.setProps(props)
  })

  return <div ref={host} className="poker-scene" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#221C19' }} />
}
