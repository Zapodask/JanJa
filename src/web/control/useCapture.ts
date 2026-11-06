import { useEffect, useRef, type RefObject } from 'react'
import type { InputMsg } from '../../shared/control'
import { toNormalized, wheelNotches } from './geometry'

const MM_INTERVAL_MS = 1000 / 60
const DOUBLE_ESC_MS = 1000
const KEY_RE = /^[A-Za-z0-9]{1,32}$/

interface CaptureOptions {
  active: boolean
  boxRef: RefObject<HTMLElement | null>
  videoRef: RefObject<HTMLVideoElement | null>
  onInput: (msg: InputMsg) => void
  onRelease: () => void
}

/**
 * Captura mouse, roda e teclado sobre a TV enquanto a pessoa controla. Sem pointer lock:
 * o cursor do controlador já aparece no vídeo. Esc duas vezes em 1 s solta o controle.
 */
export function useControlCapture({ active, boxRef, videoRef, onInput, onRelease }: CaptureOptions): void {
  const cb = useRef({ onInput, onRelease })
  cb.current = { onInput, onRelease }

  useEffect(() => {
    const box = boxRef.current
    const video = videoRef.current
    if (!active || !box || !video) return

    const keys = new Set<string>()
    const buttons = new Set<0 | 1 | 2>()
    let lastMove = 0
    let pending: { x: number; y: number } | undefined
    let flushTimer: number | undefined
    let lastEsc = 0

    const emit = (m: InputMsg) => cb.current.onInput(m)
    const overlay = (e: Event) => (e.target as Element | null)?.closest?.('.tile-bar, .control-tag') != null
    const point = (e: MouseEvent) =>
      toNormalized(e.clientX, e.clientY, video.getBoundingClientRect(), video.videoWidth, video.videoHeight)

    const sendMove = (p: { x: number; y: number }) => {
      lastMove = performance.now()
      pending = undefined
      emit({ t: 'mm', x: p.x, y: p.y })
    }
    const move = (e: MouseEvent) => {
      if (overlay(e)) return
      const p = point(e)
      if (!p) return
      const wait = MM_INTERVAL_MS - (performance.now() - lastMove)
      if (wait <= 0) return sendMove(p)
      pending = p
      flushTimer ??= window.setTimeout(() => {
        flushTimer = undefined
        if (pending) sendMove(pending)
      }, wait)
    }
    const down = (e: MouseEvent) => {
      if (overlay(e)) return
      e.preventDefault()
      e.stopPropagation()
      box.focus({ preventScroll: true })
      if (e.button > 2) return
      const p = point(e)
      if (p) sendMove(p) // posição exata antes do clique
      buttons.add(e.button as 0 | 1 | 2)
      emit({ t: 'md', b: e.button as 0 | 1 | 2 })
    }
    const up = (e: MouseEvent) => {
      if (overlay(e)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.button > 2) return
      buttons.delete(e.button as 0 | 1 | 2)
      emit({ t: 'mu', b: e.button as 0 | 1 | 2 })
    }
    const swallow = (e: Event) => {
      if (overlay(e)) return
      e.preventDefault()
      e.stopPropagation()
    }
    const wheel = (e: WheelEvent) => {
      if (overlay(e)) return
      e.preventDefault()
      e.stopPropagation()
      const dx = wheelNotches(e.deltaX, e.deltaMode)
      const dy = wheelNotches(e.deltaY, e.deltaMode)
      if (dx || dy) emit({ t: 'wh', dx, dy })
    }
    const keydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
      e.stopPropagation() // M, F e Esc da sala não devem disparar enquanto controla
      if (overlay(e)) return
      e.preventDefault()
      if (e.code === 'Escape') {
        const now = performance.now()
        if (now - lastEsc < DOUBLE_ESC_MS) {
          lastEsc = 0
          cb.current.onRelease()
          return
        }
        lastEsc = now
      }
      if (!KEY_RE.test(e.code)) return
      keys.add(e.code)
      emit({ t: 'kd', code: e.code })
    }
    const keyup = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
      e.stopPropagation()
      e.preventDefault()
      if (!KEY_RE.test(e.code) || !keys.has(e.code)) return
      keys.delete(e.code)
      emit({ t: 'ku', code: e.code })
    }
    /** perdeu o foco: solta tudo que estava apertado para não ficar tecla presa do outro lado */
    const releaseAll = () => {
      for (const code of keys) emit({ t: 'ku', code })
      for (const b of buttons) emit({ t: 'mu', b })
      keys.clear()
      buttons.clear()
    }

    box.addEventListener('mousemove', move)
    box.addEventListener('mousedown', down)
    box.addEventListener('mouseup', up)
    box.addEventListener('click', swallow)
    box.addEventListener('dblclick', swallow)
    box.addEventListener('auxclick', swallow)
    box.addEventListener('contextmenu', swallow)
    box.addEventListener('wheel', wheel, { passive: false })
    box.addEventListener('keydown', keydown)
    box.addEventListener('keyup', keyup)
    box.addEventListener('blur', releaseAll)
    box.focus({ preventScroll: true })

    return () => {
      window.clearTimeout(flushTimer)
      releaseAll()
      box.removeEventListener('mousemove', move)
      box.removeEventListener('mousedown', down)
      box.removeEventListener('mouseup', up)
      box.removeEventListener('click', swallow)
      box.removeEventListener('dblclick', swallow)
      box.removeEventListener('auxclick', swallow)
      box.removeEventListener('contextmenu', swallow)
      box.removeEventListener('wheel', wheel)
      box.removeEventListener('keydown', keydown)
      box.removeEventListener('keyup', keyup)
      box.removeEventListener('blur', releaseAll)
    }
  }, [active, boxRef, videoRef])
}
