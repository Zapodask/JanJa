import { useId } from 'react'
import { LOGO_H, LOGO_W, logoRects } from './logo'

const RECTS = logoRects()

/** Logo em pixel art (src/web/ui/logo.ts). Com `draw`, entra com a mesma linha de "TV ligando". */
export function Brand({ size = 'md', draw = false }: { size?: 'md' | 'xl'; draw?: boolean }) {
  return (
    <span className={`brand ${size} ${draw ? 'draw' : ''}`}>
      <svg viewBox={`0 0 ${LOGO_W} ${LOGO_H}`} shapeRendering="crispEdges" role="img" aria-label="JanJa">
        {RECTS.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
        ))}
      </svg>
    </span>
  )
}

/** A TV desligada: estado vazio e telas de espera. Com `noise`, um chiado discreto. */
export function TvOff({ noise = false }: { noise?: boolean }) {
  const id = useId().replace(/:/g, '')
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  return (
    <div className="tvoff" aria-hidden="true">
      <div className="tvoff-set">
        <div className="tvoff-screen">
          {noise && (
            <svg width="100%" height="100%" preserveAspectRatio="none">
              <filter id={`n${id}`} x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.9 0.04" numOctaves="1" seed="3">
                  {!still && <animate attributeName="baseFrequency" dur="9s" values="0.9 0.04;0.7 0.09;0.9 0.04" repeatCount="indefinite" />}
                </feTurbulence>
                <feColorMatrix type="matrix" values="0 0 0 0 0.95  0 0 0 0 0.92  0 0 0 0 0.86  0.9 0 0 0 -0.25" />
              </filter>
              <rect width="100%" height="100%" filter={`url(#n${id})`} opacity="0.55" />
              <pattern id={`l${id}`} width="4" height="4" patternUnits="userSpaceOnUse">
                <rect width="4" height="1" fill="#000" opacity="0.5" />
              </pattern>
              <rect width="100%" height="100%" fill={`url(#l${id})`} />
            </svg>
          )}
          <i className="tvoff-glare" />
        </div>
        <i className="tvoff-led" />
      </div>
      <i className="tvoff-leg l" />
      <i className="tvoff-leg r" />
    </div>
  )
}
