import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PoolSceneProps } from '../../contract'
import { CANVAS_H, CANVAS_W, PoolEngine } from './engine'

/** Casca React da mesa: cria o motor, ajusta o tamanho (escala inteira quando dá) e o botão da bola na mão. */
export function PoolScene(props: PoolSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<PoolEngine | null>(null)
  const [size, setSize] = useState({ w: CANVAS_W * 2, h: CANVAS_H * 2 })
  const [placeSeq, setPlaceSeq] = useState(0)
  const v = props.view
  const myTurn = !!v.you && v.turn === v.you.index && v.winner === null

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const fit = () => {
      const s = Math.min((el.clientWidth - 24) / CANVAS_W, (el.clientHeight - 56) / CANVAS_H)
      // escala inteira fica mais nítida; abaixo de 2x, usa a fracionária
      const k = s >= 2 ? Math.floor(s) : Math.max(0.5, s)
      setSize({ w: Math.round(CANVAS_W * k), h: Math.round(CANVAS_H * k) })
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const eng = new PoolEngine(c)
    engineRef.current = eng
    return () => {
      eng.dispose()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setProps({ view: props.view, reducedMotion: props.reducedMotion, onShoot: props.onShoot, onSfx: props.onSfx, placeSeq })
  })

  return (
    <div className="pl-scene" ref={hostRef}>
      <canvas
        ref={canvasRef}
        className="pl-canvas"
        style={{ width: size.w, height: size.h }}
        tabIndex={0}
        aria-label={
          myTurn
            ? 'Mesa de sinuca. Mire com o mouse ou com as setas; segure o clique ou o Espaço para dar força e solte para tacar.'
            : 'Mesa de sinuca.'
        }
      />
      <div className="pl-tips">
        {myTurn && v.ballInHand && (
          <button onClick={() => setPlaceSeq((n) => n + 1)} data-tip="Clique na mesa onde a branca vai ficar">
            Mover a branca
          </button>
        )}
        {myTurn && v.onEight && <span className="pl-eight">Clique numa caçapa para escolher onde a 8 vai cair.</span>}
      </div>
    </div>
  )
}
