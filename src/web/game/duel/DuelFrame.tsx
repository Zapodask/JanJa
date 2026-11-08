import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { DuelPlayerView, DuelView, Side } from '../../../shared/games/duel'
import { formatClock } from '../helpers'
import { useServerNow } from '../useServerNow'

/** altura de cada placa de jogador (px CSS) */
const PLATE = 44

interface PlateProps {
  player: DuelPlayerView
  side: Side
  tone: string
  clock: number | null
  active: boolean
  you: boolean
  extra?: ReactNode
}

function Plate({ player, side, tone, clock, active, you, extra }: PlateProps) {
  const low = clock !== null && clock < 20_000
  return (
    <div className={`chess-plate ${active ? 'active' : ''}`} style={{ height: PLATE }}>
      <i className="golf-dot" style={{ background: tone }} aria-hidden="true" />
      <span className="chess-plate-name">
        {player.name}
        {you ? ' (você)' : ''}
        <small className="detail">{player.away ? 'fora da sala' : side === 'w' ? 'brancas' : 'pretas'}</small>
      </span>
      <span className="chess-captured">{extra}</span>
      {clock !== null && (
        <span className={`chess-clock pixel-font ${active ? 'on' : ''} ${low ? 'low' : ''}`} aria-label={`Relógio de ${player.name}: ${formatClock(clock)}`}>
          {formatClock(clock)}
        </span>
      )}
    </div>
  )
}

interface Props {
  view: DuelView & { turn: Side; you: { color: Side } | null }
  colors: Record<string, string>
  /** o que cada lado capturou (fica na placa dele) */
  captured: (side: Side) => ReactNode
  /** o tabuleiro, no tamanho (px) que cabe */
  children: (size: number) => ReactNode
}

/**
 * Moldura dos jogos de tabuleiro para dois (xadrez e damas): placa do outro em cima, a sua embaixo,
 * com nome, capturas e relógio andando; o tabuleiro no meio, quadrado, do maior tamanho que cabe.
 */
export function DuelFrame({ view, colors, captured, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(320)
  const now = useServerNow(view.serverNow, 250)

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const fit = () => setSize(Math.max(160, Math.floor(Math.min(el.clientWidth - 32, el.clientHeight - 2 * PLATE - 32))))
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])

  const clockOf = (c: Side): number | null => {
    if (!view.clock) return null
    const running = !view.result && view.turn === c
    return Math.max(0, view.clock[c] - (running ? now - view.serverNow : 0))
  }
  const bottom: Side = view.you?.color === 'b' ? 'b' : 'w'
  const plate = (c: Side) => {
    const pl = c === 'w' ? view.white : view.black
    return (
      <Plate
        player={pl}
        side={c}
        tone={colors[pl.playerId] ?? '#B7A99A'}
        clock={clockOf(c)}
        active={!view.result && view.turn === c}
        you={view.you?.color === c}
        extra={captured(c)}
      />
    )
  }

  return (
    <div className="chess-scene" ref={hostRef}>
      <div className="chess-stack" style={{ width: size }}>
        {plate(bottom === 'w' ? 'b' : 'w')}
        <div className="chess-board-wrap" style={{ width: size, height: size }}>
          {children(size)}
        </div>
        {plate(bottom)}
      </div>
    </div>
  )
}
