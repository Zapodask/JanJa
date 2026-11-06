import { useEffect, useState } from 'react'
import { frameRects, POSES, SIZE, TV_FRAMES, type Frame, type PoseName } from './pixelData'

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

function Sprite({ frame, size, className }: { frame: Frame; size: number; className?: string }) {
  return (
    <svg
      className={`pixel ${className ?? ''}`}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {frameRects(frame).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  )
}

/** Chão que rola (linha de 2 px) para dar ideia de caminhada. */
function Ground({ size, step }: { size: number; step: number }) {
  const shift = (step * 2) % 8
  return (
    <svg className="pixel ground" viewBox="0 0 24 2" width={size} height={size / 12} shapeRendering="crispEdges" aria-hidden="true">
      {[-1, 0, 1, 2, 3].map((i) => (
        <rect key={i} x={i * 8 - shift} y={0} width={5} height={2} fill="#3B312C" />
      ))}
    </svg>
  )
}

interface JanProps {
  pose: PoseName
  /** múltiplo de 24 (96, 120, 144, 192) */
  size?: number
}

/** Jan, o mascote. Decorativo (sempre ao lado de texto que já diz tudo). */
export function Jan({ pose, size = 144 }: JanProps) {
  const reduced = usePrefersReducedMotion()
  const def = POSES[pose]
  const [step, setStep] = useState(0)

  useEffect(() => {
    setStep(0)
    if (reduced) return
    const t = setInterval(() => setStep((s) => (s + 1) % def.seq.length), def.ms)
    return () => clearInterval(t)
  }, [pose, reduced, def])

  const frame = def.frames[reduced ? 0 : def.seq[step % def.seq.length]]
  return (
    <div className={`jan jan-${pose}`} style={{ width: size }}>
      <Sprite frame={frame} size={size} />
      {pose === 'walk' && <Ground size={size} step={reduced ? 0 : step} />}
    </div>
  )
}

/** TV pixel: liga (linha, abre, flash, imagem) quando `on` vira true. */
export function PixelTv({ on, size = 96 }: { on: boolean; size?: number }) {
  const reduced = usePrefersReducedMotion()
  const [i, setI] = useState(0)

  useEffect(() => {
    if (!on) {
      setI(0)
      return
    }
    if (reduced) {
      setI(TV_FRAMES.length - 1)
      return
    }
    let n = 0
    const t = setInterval(() => {
      n++
      setI(n)
      if (n >= TV_FRAMES.length - 1) clearInterval(t)
    }, 110)
    return () => clearInterval(t)
  }, [on, reduced])

  return (
    <div className="pixel-tv" style={{ width: size }}>
      <Sprite frame={TV_FRAMES[i]} size={size} />
    </div>
  )
}
