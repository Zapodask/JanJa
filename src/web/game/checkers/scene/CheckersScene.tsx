import '@fontsource-variable/pixelify-sans'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { sideOfPiece } from '../../../../shared/games/checkers/rules'
import type { Side } from '../../../../shared/games/duel'
import type { CheckersSceneProps } from '../../contract'
import { DuelFrame } from '../../duel/DuelFrame'
import { DISC_SIZE, discRuns } from './pieces'

const CELL = DISC_SIZE
const BOARD = CELL * 8
const LIGHT = '#C9B79C'
const DARK = '#8C6E58'
const FILES = 'abcdefgh'

const sqName = (f: number, r: number): string => FILES[f] + String(r + 1)
const sqIndex = (s: string): number => s.charCodeAt(0) - 97 + (Number(s[1]) - 1) * 8
const fileOf = (s: string): number => s.charCodeAt(0) - 97
const rankOf = (s: string): number => Number(s[1]) - 1

function pieceName(p: string): string {
  const king = p === 'W' || p === 'B'
  const white = p.toLowerCase() === 'w'
  return king ? `dama ${white ? 'branca' : 'preta'}` : `pedra ${white ? 'branca' : 'preta'}`
}

function Disc({ p }: { p: string }) {
  return (
    <>
      {discRuns(p).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </>
  )
}

const startsWith = (path: string[], prefix: string[]) => prefix.every((s, i) => path[i] === s)

/**
 * Tabuleiro das damas. Clique na peça e depois na casa final (ou em cada parada, quando
 * mais de um caminho chega no mesmo lugar). Arrastar também vale. Teclado: setas, Enter e Esc.
 */
export function CheckersScene({ view, colors, reducedMotion, onMove }: CheckersSceneProps) {
  const flip = view.you?.color === 'b'
  const myTurn = !!view.you && view.turn === view.you.color && !view.result
  const svgRef = useRef<SVGSVGElement>(null)
  /** caminho escolhido até agora (origem e paradas) */
  const [sel, setSel] = useState<string[]>([])
  const [cursor, setCursor] = useState(flip ? 'd6' : 'c3')
  const [focused, setFocused] = useState(false)
  const [drag, setDrag] = useState<{ from: string; x: number; y: number; moved: boolean; wasSel: boolean } | null>(null)
  const dropped = useRef<string | null>(null)

  useEffect(() => {
    setSel([])
    setDrag(null)
  }, [view.moves.length, view.turn, myTurn])

  const col = (s: string) => (flip ? 7 - fileOf(s) : fileOf(s))
  const row = (s: string) => (flip ? rankOf(s) : 7 - rankOf(s))
  const at = (c: number, r: number) => (flip ? sqName(7 - c, r) : sqName(c, 7 - r))

  const movable = new Set(view.legal.map((p) => p[0]))
  const cands = sel.length ? view.legal.filter((p) => startsWith(p, sel)) : []
  const next = [...new Set(cands.map((p) => p[sel.length]).filter(Boolean))]

  const send = (path: string[], viaDrag: boolean) => {
    dropped.current = viaDrag ? path.join() : null
    setSel([])
    onMove(path)
  }

  /** escolhe a casa `s` a partir do caminho `cur` */
  const choose = (cur: string[], s: string, viaDrag = false) => {
    const now = cur.length ? view.legal.filter((p) => startsWith(p, cur)) : []
    if (now.length) {
      if (s === cur[cur.length - 1]) return setSel(cur.length === 1 ? [] : cur.slice(0, -1))
      // próxima parada
      const step = [...cur, s]
      const via = now.filter((p) => p[cur.length] === s)
      if (via.length) {
        const done = via.find((p) => p.length === step.length)
        if (done && via.length === 1) return send(done, viaDrag)
        return setSel(step)
      }
      // clicou direto na casa final: vale se só um caminho termina ali
      const ends = now.filter((p) => p[p.length - 1] === s)
      if (ends.length === 1) return send(ends[0], viaDrag)
    }
    setSel(movable.has(s) ? [s] : [])
  }

  const toBoard = (e: PointerEvent): { x: number; y: number; sq: string | null } => {
    const r = svgRef.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * BOARD
    const y = ((e.clientY - r.top) / r.height) * BOARD
    const c = Math.floor(x / CELL)
    const rw = Math.floor(y / CELL)
    return { x, y, sq: c >= 0 && c < 8 && rw >= 0 && rw < 8 ? at(c, rw) : null }
  }

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!myTurn) return
    const { x, y, sq } = toBoard(e)
    if (!sq) return
    setCursor(sq)
    if (sel.length && !movable.has(sq)) return choose(sel, sq)
    if (!movable.has(sq)) return setSel([])
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ from: sq, x, y, moved: false, wasSel: sel.length === 1 && sel[0] === sq })
    setSel([sq])
  }
  const onMoveP = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return
    const { x, y } = toBoard(e)
    setDrag({ ...drag, x, y, moved: drag.moved || Math.hypot(x - drag.x, y - drag.y) > 3 })
  }
  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return
    const { sq } = toBoard(e)
    setDrag(null)
    if (sq && sq !== drag.from) choose([drag.from], sq, true)
    else if (sq === drag.from && drag.wasSel && !drag.moved) setSel([])
  }

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (d[e.key] || e.key === 'Enter' || e.key === ' ') setFocused(true)
    if (d[e.key]) {
      e.preventDefault()
      setCursor(at(Math.min(7, Math.max(0, col(cursor) + d[e.key][0])), Math.min(7, Math.max(0, row(cursor) + d[e.key][1]))))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (myTurn) choose(sel, cursor)
    } else if (e.key === 'Escape' && sel.length) {
      e.stopPropagation()
      setSel([])
    }
  }

  // a cor da peça capturada diz quem capturou
  const captured = (by: Side) => view.moves.flatMap((m) => m.pieces.filter((p) => sideOfPiece(p) !== by))

  const last = view.lastMove
  const lastFrom = last?.path[0]
  const lastTo = last?.path[last.path.length - 1]
  const slide: CSSProperties | undefined =
    last && lastFrom && lastTo && !reducedMotion && dropped.current !== last.path.join()
      ? ({ '--dx': `${(col(lastFrom) - col(lastTo)) * CELL}px`, '--dy': `${(row(lastFrom) - row(lastTo)) * CELL}px` } as CSSProperties)
      : undefined
  const cursorPiece = view.board[sqIndex(cursor)]
  const youLabel = view.you ? `Você joga de ${view.you.color === 'w' ? 'brancas' : 'pretas'}.` : 'Você está assistindo.'
  const rect = (s: string, fill: string, opacity: number, key: string) => (
    <rect key={key} x={col(s) * CELL} y={row(s) * CELL} width={CELL} height={CELL} fill={fill} opacity={opacity} />
  )

  return (
    <DuelFrame
      view={view}
      colors={colors}
      captured={(c) => {
        const xs = captured(c)
        return (
          <span className="chess-captured-list" aria-label={xs.length ? `Capturou ${xs.length} ${xs.length === 1 ? 'peça' : 'peças'}` : undefined}>
            {xs.map((p, i) => (
              <svg key={i} viewBox={`0 0 ${CELL} ${CELL}`} width={20} height={20} shapeRendering="crispEdges" aria-hidden="true">
                <Disc p={p} />
              </svg>
            ))}
          </span>
        )
      }}
    >
      {(size) => (
        <>
          <svg
            ref={svgRef}
            className={`chess-board ${myTurn ? 'my-turn' : ''}`}
            viewBox={`0 0 ${BOARD} ${BOARD}`}
            width={size}
            height={size}
            shapeRendering="crispEdges"
            tabIndex={0}
            role="application"
            aria-label={`Tabuleiro de damas. ${youLabel} Setas andam pelas casas, Enter escolhe a peça e a casa.`}
            onPointerDown={onDown}
            onPointerMove={onMoveP}
            onPointerUp={onUp}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={onKey}
            onFocus={(e) => setFocused(e.currentTarget.matches(':focus-visible'))}
            onBlur={() => setFocused(false)}
          >
            {Array.from({ length: 64 }, (_, i) => {
              const s = at(i % 8, Math.floor(i / 8))
              const dark = (fileOf(s) + rankOf(s)) % 2 === 0
              return <rect key={s} x={(i % 8) * CELL} y={Math.floor(i / 8) * CELL} width={CELL} height={CELL} fill={dark ? DARK : LIGHT} />
            })}
            {last?.path.map((s, i) => rect(s, '#FFC94A', 0.28, `l${i}${s}`))}
            {last?.captured.map((s) => rect(s, '#FF7A6B', 0.35, `c${s}`))}
            {sel.map((s, i) => rect(s, '#FFC94A', 0.6, `s${i}${s}`))}
            {Array.from({ length: 8 }, (_, i) => (
              <g key={`k${i}`} className="chess-coord">
                <text x={i * CELL + CELL - 1} y={BOARD - 1} textAnchor="end" fill={(i + (flip ? 1 : 0)) % 2 === 0 ? LIGHT : DARK}>
                  {flip ? FILES[7 - i] : FILES[i]}
                </text>
                <text x={1} y={i * CELL + 4.5} fill={(i + (flip ? 1 : 0)) % 2 === 0 ? DARK : LIGHT}>
                  {flip ? i + 1 : 8 - i}
                </text>
              </g>
            ))}
            {view.board.map((p, i) => {
              if (p === '.') return null
              const s = sqName(i % 8, Math.floor(i / 8))
              const lifted = drag?.moved && drag.from === s
              const moving = !!slide && s === lastTo
              return (
                <g key={moving ? `${s}-${view.moves.length}` : s} transform={`translate(${col(s) * CELL} ${row(s) * CELL})`} opacity={lifted ? 0.35 : 1}>
                  <g className={moving ? 'chess-slide' : undefined} style={moving ? slide : undefined}>
                    <Disc p={p} />
                  </g>
                </g>
              )
            })}
            {/* captura obrigatória: marca quem pode capturar */}
            {myTurn &&
              view.mustCapture &&
              !sel.length &&
              [...movable].map((s) => (
                <rect
                  key={`m${s}`}
                  x={col(s) * CELL + 0.5}
                  y={row(s) * CELL + 0.5}
                  width={CELL - 1}
                  height={CELL - 1}
                  fill="none"
                  stroke="#FFC94A"
                  strokeDasharray="2 1"
                />
              ))}
            {next.map((s) => (
              <circle key={`t${s}`} cx={col(s) * CELL + CELL / 2} cy={row(s) * CELL + CELL / 2} r={2.4} fill="#221C19" fillOpacity={0.55} shapeRendering="geometricPrecision" />
            ))}
            {focused && (
              <rect x={col(cursor) * CELL + 0.5} y={row(cursor) * CELL + 0.5} width={CELL - 1} height={CELL - 1} fill="none" stroke="#FFC94A" strokeWidth={1} />
            )}
            {drag?.moved && (
              <g transform={`translate(${drag.x - CELL / 2} ${drag.y - CELL / 2 - 2})`} pointerEvents="none">
                <Disc p={view.board[sqIndex(drag.from)]} />
              </g>
            )}
          </svg>
          <div className="sr-only" aria-live="polite">
            {focused ? `${cursor}: ${cursorPiece === '.' ? 'vazia' : pieceName(cursorPiece)}${sel.length ? `. Caminho: ${sel.join(', ')}` : ''}` : ''}
          </div>
        </>
      )}
    </DuelFrame>
  )
}
