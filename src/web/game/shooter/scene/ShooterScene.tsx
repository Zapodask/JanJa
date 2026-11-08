import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { BTN_DASH, BTN_GRENADE } from '../../../../shared/games/shooter/types'
import type { ShooterSceneProps, TouchUiState } from '../contract'
import type { ShooterEngine } from './engine'
import { STICK_RADIUS } from './input'

/** Cena Pixi do tiro. O módulo do Pixi só é carregado aqui, por import dinâmico. */
export function ShooterScene(props: ShooterSceneProps): ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<ShooterEngine | null>(null)
  const latest = useRef(props)
  latest.current = props
  const moveBase = useRef<HTMLDivElement>(null)
  const moveKnob = useRef<HTMLDivElement>(null)
  const aimBase = useRef<HTMLDivElement>(null)
  const aimKnob = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let dead = false
    let ro: ResizeObserver | null = null
    // aparelho só de toque (celular, tablet): mostra joysticks e botões desde o começo
    try {
      if (navigator.maxTouchPoints > 0 && window.matchMedia('(hover: none)').matches) el.classList.add('is-touch')
    } catch {
      /* sem matchMedia */
    }
    void import('./engine').then(async ({ ShooterEngine }) => {
      if (dead) return
      const eng = new ShooterEngine(el)
      engine.current = eng
      eng.onTouchUi = (t) => paintTouch(t, { moveBase, moveKnob, aimBase, aimKnob }, el)
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

  const hold = (bit: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      host.current?.classList.add('is-touch')
      engine.current?.setTouchButton(bit, true)
    },
    onPointerUp: () => engine.current?.setTouchButton(bit, false),
    onPointerCancel: () => engine.current?.setTouchButton(bit, false),
    onLostPointerCapture: () => engine.current?.setTouchButton(bit, false)
  })

  return (
    <div ref={host} className="tiro-scene" tabIndex={-1} aria-label="Cena do Tiro na Sala">
      <div className="tiro-touch" aria-hidden="true">
        <div ref={moveBase} className="tiro-stick" hidden>
          <div ref={moveKnob} className="tiro-knob" />
        </div>
        <div ref={aimBase} className="tiro-stick aim" hidden>
          <div ref={aimKnob} className="tiro-knob" />
        </div>
        <button type="button" className="tiro-btn dash" data-tiro-btn tabIndex={-1} {...hold(BTN_DASH)}>
          Dash
        </button>
        <button type="button" className="tiro-btn bomb" data-tiro-btn tabIndex={-1} {...hold(BTN_GRENADE)}>
          Granada
        </button>
      </div>
    </div>
  )
}

interface Refs {
  moveBase: React.RefObject<HTMLDivElement | null>
  moveKnob: React.RefObject<HTMLDivElement | null>
  aimBase: React.RefObject<HTMLDivElement | null>
  aimKnob: React.RefObject<HTMLDivElement | null>
}

function paintTouch(t: TouchUiState, r: Refs, host: HTMLElement): void {
  host.classList.add('is-touch')
  const put = (base: HTMLDivElement | null, knob: HTMLDivElement | null, s: TouchUiState['move'], hot: boolean) => {
    if (!base || !knob) return
    base.hidden = !s.active
    if (!s.active) return
    base.style.left = `${s.cx}px`
    base.style.top = `${s.cy}px`
    const l = Math.hypot(s.x, s.y)
    const k = l > STICK_RADIUS ? STICK_RADIUS / l : 1
    knob.style.transform = `translate(${s.x * k}px, ${s.y * k}px)`
    base.classList.toggle('hot', hot)
  }
  put(r.moveBase.current, r.moveKnob.current, t.move, false)
  put(r.aimBase.current, r.aimKnob.current, t.aim, t.aim.fire)
}
