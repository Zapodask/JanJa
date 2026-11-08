import { useEffect, useRef } from 'react'
import type { GolfSceneProps } from '../../contract'
import type { GolfEngine } from './engine'

/** Casca React da cena 3D: cria o motor, acompanha o tamanho e repassa as props. */
export function GolfScene(props: GolfSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<GolfEngine | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let dead = false
    let ro: ResizeObserver | undefined
    void import('./engine').then(({ GolfEngine }) => {
      if (dead) return
      const eng = new GolfEngine(el)
      engineRef.current = eng
      ro = new ResizeObserver(() => eng.resize(el.clientWidth, el.clientHeight))
      ro.observe(el)
      eng.resize(el.clientWidth, el.clientHeight)
      eng.setProps(propsRef.current)
    })
    return () => {
      dead = true
      ro?.disconnect()
      engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setProps(props)
  })

  return <div ref={hostRef} className="golf-scene" />
}
