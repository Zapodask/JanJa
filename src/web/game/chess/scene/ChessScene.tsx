import '@fontsource-variable/pixelify-sans'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { colorOf, typeOf, type Color, type PieceType, type Promo } from '../../../../shared/games/chess/rules'
import type { ChessSceneProps } from '../../contract'
import { DuelFrame } from '../../duel/DuelFrame'
import { PIECE_SIZE, pieceRuns } from './pieces'

const CELL = PIECE_SIZE
const BOARD = CELL * 8
const LIGHT = '#C9B79C'
const DARK = '#8C6E58'

const FILES = 'abcdefgh'
const NAME: Record<PieceType, [string, boolean]> = {
  p: ['peão', false],
  n: ['cavalo', false],
  b: ['bispo', false],
  r: ['torre', true],
  q: ['dama', true],
  k: ['rei', false]
}

const sqName = (f: number, r: number): string => FILES[f] + String(r + 1)
const sqIndex = (s: string): number => s.charCodeAt(0) - 97 + (Number(s[1]) - 1) * 8
const fileOf = (s: string): number => s.charCodeAt(0) - 97
const rankOf = (s: string): number => Number(s[1]) - 1

function pieceName(p: string): string {
  const [n, fem] = NAME[typeOf(p)]
  const c = colorOf(p) === 'w' ? (fem ? 'branca' : 'branco') : fem ? 'preta' : 'preto'
  return `${n} ${c}`
}

/** desenho da peça em coordenadas da casa (0..16) */
function Piece({ p }: { p: string }) {
  return (
    <>
      {pieceRuns(typeOf(p), colorOf(p) as Color).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </>
  )
}

/** Peça solta (fora do tabuleiro): capturas e escolha da promoção. */
function PieceIcon({ p, size }: { p: string; size: number }) {
  return (
    <svg viewBox={`0 0 ${CELL} ${CELL}`} width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
      <Piece p={p} />
    </svg>
  )
}

const ORDER: PieceType[] = ['q', 'r', 'b', 'n', 'p']
const sortCaptured = (xs: string[]): string[] => [...xs].sort((a, b) => ORDER.indexOf(typeOf(a)) - ORDER.indexOf(typeOf(b)))

/** Tabuleiro do xadrez: arrastar ou clicar na peça e depois na casa. Teclado: setas, Enter e Esc. */
export function ChessScene({ view, colors, reducedMotion, onMove }: ChessSceneProps) {
  const flip = view.you?.color === 'b'
  const myTurn = !!view.you && view.turn === view.you.color && !view.result
  const svgRef = useRef<SVGSVGElement>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [cursor, setCursor] = useState(flip ? 'e7' : 'e2')
  const [focused, setFocused] = useState(false)
  const [drag, setDrag] = useState<{ from: string; x: number; y: number; moved: boolean; wasSel: boolean } | null>(null)
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null)
  /** lance que eu soltei arrastando: não anima de novo */
  const dropped = useRef<string | null>(null)

  useEffect(() => {
    setSel(null)
    setPromo(null)
    setDrag(null)
  }, [view.moves.length, view.turn, myTurn])

  const targets = sel ? (view.legal[sel] ?? []) : []

  // casa <-> posição na tela (de pretas, o tabuleiro vira)
  const col = (s: string) => (flip ? 7 - fileOf(s) : fileOf(s))
  const row = (s: string) => (flip ? rankOf(s) : 7 - rankOf(s))
  const at = (c: number, r: number) => (flip ? sqName(7 - c, r) : sqName(c, 7 - r))

  const tryMove = (from: string, to: string, viaDrag = false) => {
    const p = view.board[sqIndex(from)]
    setSel(null)
    if (typeOf(p) === 'p' && (rankOf(to) === 7 || rankOf(to) === 0)) return setPromo({ from, to })
    dropped.current = viaDrag ? from + to : null
    onMove(from, to)
  }

  const pick = (s: string) => {
    if (sel && targets.includes(s)) tryMove(sel, s)
    else if (view.legal[s] && sel !== s) setSel(s)
    else setSel(null)
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
    if (!myTurn || promo) return
    const { x, y, sq } = toBoard(e)
    if (!sq) return
    setCursor(sq)
    if (sel && targets.includes(sq)) return tryMove(sel, sq)
    if (!view.legal[sq]) return setSel(null)
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ from: sq, x, y, moved: false, wasSel: sel === sq })
    setSel(sq)
  }
  const onMoveP = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return
    const { x, y } = toBoard(e)
    const moved = drag.moved || Math.hypot(x - drag.x, y - drag.y) > 3
    setDrag({ ...drag, x, y, moved })
  }
  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return
    const { sq } = toBoard(e)
    setDrag(null)
    if (sq && sq !== drag.from && view.legal[drag.from]?.includes(sq)) tryMove(drag.from, sq, true)
    else if (sq === drag.from && drag.wasSel && !drag.moved) setSel(null)
  }

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (d[e.key] || e.key === 'Enter' || e.key === ' ') setFocused(true)
    if (d[e.key]) {
      e.preventDefault()
      const c = Math.min(7, Math.max(0, col(cursor) + d[e.key][0]))
      const r = Math.min(7, Math.max(0, row(cursor) + d[e.key][1]))
      setCursor(at(c, r))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (myTurn) pick(cursor)
    } else if (e.key === 'Escape' && sel) {
      e.stopPropagation()
      setSel(null)
    }
  }

  // a cor da peça capturada diz quem capturou
  const captured = (by: Color) => sortCaptured(view.moves.flatMap((m) => (m.captured && colorOf(m.captured) !== by ? [m.captured] : [])))

  const last = view.lastMove
  const slideKey = view.moves.length
  const slide: CSSProperties | undefined =
    last && !reducedMotion && dropped.current !== last.from + last.to
      ? ({ '--dx': `${(col(last.from) - col(last.to)) * CELL}px`, '--dy': `${(row(last.from) - row(last.to)) * CELL}px` } as CSSProperties)
      : undefined

  const cursorPiece = view.board[sqIndex(cursor)]
  const youLabel = view.you ? `Você joga de ${view.you.color === 'w' ? 'brancas' : 'pretas'}.` : 'Você está assistindo.'

  return (
    <DuelFrame
      view={view}
      colors={colors}
      captured={(c) => {
        const xs = captured(c)
        return (
          <span className="chess-captured-list" aria-label={xs.length ? `Capturou: ${xs.map(pieceName).join(', ')}` : undefined}>
            {xs.map((p, i) => (
              <PieceIcon key={i} p={p} size={20} />
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
            aria-label={`Tabuleiro de xadrez. ${youLabel} Setas andam pelas casas, Enter escolhe a peça e a casa.`}
            onPointerDown={onDown}
            onPointerMove={onMoveP}
            onPointerUp={onUp}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={onKey}
            onFocus={(e) => setFocused(e.currentTarget.matches(':focus-visible'))}
            onBlur={() => setFocused(false)}
          >
            {Array.from({ length: 64 }, (_, i) => {
              const c = i % 8
              const r = Math.floor(i / 8)
              const s = at(c, r)
              const light = (fileOf(s) + rankOf(s)) % 2 === 1
              return <rect key={s} x={c * CELL} y={r * CELL} width={CELL} height={CELL} fill={light ? LIGHT : DARK} />
            })}
            {last &&
              [last.from, last.to].map((s) => (
                <rect key={`l${s}`} x={col(s) * CELL} y={row(s) * CELL} width={CELL} height={CELL} fill="#FFC94A" opacity={0.32} />
              ))}
            {view.check && (
              <rect x={col(view.check) * CELL} y={row(view.check) * CELL} width={CELL} height={CELL} fill="#FF7A6B" opacity={0.75} />
            )}
            {sel && <rect x={col(sel) * CELL} y={row(sel) * CELL} width={CELL} height={CELL} fill="#FFC94A" opacity={0.6} />}
            {/* coordenadas na borda */}
            {Array.from({ length: 8 }, (_, i) => (
              <g key={`c${i}`} className="chess-coord">
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
              const moving = !!slide && s === last?.to
              return (
                <g key={moving ? `${s}-${slideKey}` : s} transform={`translate(${col(s) * CELL} ${row(s) * CELL})`} opacity={lifted ? 0.35 : 1}>
                  <g className={moving ? 'chess-slide' : undefined} style={moving ? slide : undefined}>
                    <Piece p={p} />
                  </g>
                </g>
              )
            })}
            {targets.map((s) => {
              const cap = view.board[sqIndex(s)] !== '.' || (typeOf(view.board[sqIndex(sel!)]) === 'p' && fileOf(s) !== fileOf(sel!))
              const cx = col(s) * CELL + CELL / 2
              const cy = row(s) * CELL + CELL / 2
              return cap ? (
                <circle key={`t${s}`} cx={cx} cy={cy} r={7} fill="none" stroke="#221C19" strokeOpacity={0.55} strokeWidth={1.5} shapeRendering="geometricPrecision" />
              ) : (
                <circle key={`t${s}`} cx={cx} cy={cy} r={2.4} fill="#221C19" fillOpacity={0.5} shapeRendering="geometricPrecision" />
              )
            })}
            {focused && (
              <rect
                x={col(cursor) * CELL + 0.5}
                y={row(cursor) * CELL + 0.5}
                width={CELL - 1}
                height={CELL - 1}
                fill="none"
                stroke="#FFC94A"
                strokeWidth={1}
              />
            )}
            {drag?.moved && (
              <g transform={`translate(${drag.x - CELL / 2} ${drag.y - CELL / 2 - 2})`} pointerEvents="none">
                <Piece p={view.board[sqIndex(drag.from)]} />
              </g>
            )}
          </svg>
          <div className="sr-only" aria-live="polite">
            {focused ? `${cursor}: ${cursorPiece === '.' ? 'vazia' : pieceName(cursorPiece)}${sel ? `. Escolhida: ${sel}` : ''}` : ''}
          </div>
          {promo && view.you && (
            <PromoPicker
              color={view.you.color}
              onPick={(p) => {
                onMove(promo.from, promo.to, p)
                setPromo(null)
              }}
              onCancel={() => setPromo(null)}
            />
          )}
        </>
      )}
    </DuelFrame>
  )
}

function PromoPicker({ color, onPick, onCancel }: { color: Color; onPick: (p: Promo) => void; onCancel: () => void }) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [])
  const names: Record<Promo, string> = { q: 'Dama', r: 'Torre', b: 'Bispo', n: 'Cavalo' }
  return (
    <div
      className="chess-promo"
      role="dialog"
      aria-label="Promover o peão"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <strong className="pixel-font">Virar o quê?</strong>
      <div className="chess-promo-row">
        {(['q', 'r', 'b', 'n'] as const).map((p, i) => (
          <button key={p} ref={i === 0 ? first : undefined} onClick={() => onPick(p)} aria-label={names[p]} data-tip={names[p]}>
            <PieceIcon p={color === 'w' ? p.toUpperCase() : p} size={48} />
          </button>
        ))}
      </div>
      <button className="chess-promo-cancel" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  )
}
