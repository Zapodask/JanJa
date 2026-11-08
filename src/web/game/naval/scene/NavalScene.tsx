import '@fontsource-variable/pixelify-sans'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cellName, FLEET, fits, key, randomFleet, SIZE, shipDef, type Cell, type Dir, type Placement } from '../../../../shared/games/naval/fleet'
import type { NavalView, Shot } from '../../../../shared/games/naval/types'
import { Icon } from '../../../ui/icons'
import type { NavalSceneProps } from '../../contract'
import { CELL_PX, HIT, MISS, runs, shipSprite, type Sprite } from './pixel'

/** margem das letras e números, em pixels da arte */
const GUT = 7
const BOARD_PX = GUT + SIZE * CELL_PX
const COLS = 'ABCDEFGHIJ'
const mathRng = { int: (max: number) => Math.floor(Math.random() * max) }

function Pixels({ sprite, x, y }: { sprite: Sprite; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {runs(sprite).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </g>
  )
}

function Ship({ p, ghost, bad, sunk }: { p: Placement; ghost?: boolean; bad?: boolean; sunk?: boolean }) {
  const size = shipDef(p.id)?.size ?? 2
  const x0 = GUT + p.x * CELL_PX
  const y0 = GUT + p.y * CELL_PX
  // em pé: o mesmo desenho girado 90 graus
  const t = p.dir === 'h' ? `translate(${x0} ${y0})` : `translate(${x0 + CELL_PX} ${y0}) rotate(90)`
  return (
    <g transform={t} opacity={ghost ? 0.6 : 1} className={`nv-ship ${sunk ? 'sunk' : ''}`}>
      {runs(shipSprite(size)).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={bad ? '#E05A4A' : r.fill} />
      ))}
    </g>
  )
}

interface BoardProps {
  title: string
  size: number
  ships: Placement[]
  sunk: Placement[]
  shots: Shot[]
  last: Shot[] | null
  /** casas escolhidas (salva) */
  picked?: Cell[]
  preview?: { p: Placement; ok: boolean } | null
  cursor?: Cell | null
  active?: boolean
  label: string
  onCell?: (c: Cell) => void
  onHover?: (c: Cell | null) => void
  onKey?: (e: KeyboardEvent<SVGSVGElement>) => void
}

function Board(b: BoardProps) {
  const ref = useRef<SVGSVGElement>(null)
  const toCell = (e: PointerEvent): Cell | null => {
    const r = ref.current!.getBoundingClientRect()
    const x = Math.floor((((e.clientX - r.left) / r.width) * BOARD_PX - GUT) / CELL_PX)
    const y = Math.floor((((e.clientY - r.top) / r.height) * BOARD_PX - GUT) / CELL_PX)
    return x >= 0 && y >= 0 && x < SIZE && y < SIZE ? { x, y } : null
  }
  const lastKeys = new Set((b.last ?? []).map(key))
  return (
    <figure className={`nv-board ${b.active ? 'active' : ''}`}>
      <figcaption className="pixel-font">{b.title}</figcaption>
      <svg
        ref={ref}
        viewBox={`0 0 ${BOARD_PX} ${BOARD_PX}`}
        width={b.size}
        height={b.size}
        shapeRendering="crispEdges"
        tabIndex={b.onKey ? 0 : undefined}
        role={b.onCell ? 'application' : 'img'}
        aria-label={b.label}
        onPointerMove={b.onHover ? (e) => b.onHover?.(toCell(e)) : undefined}
        onPointerLeave={b.onHover ? () => b.onHover?.(null) : undefined}
        onPointerDown={b.onCell ? (e) => {
          const c = toCell(e)
          if (c) b.onCell?.(c)
        } : undefined}
        onKeyDown={b.onKey}
        className={b.onCell ? 'clickable' : undefined}
      >
        {Array.from({ length: SIZE }, (_, i) => (
          <g key={`l${i}`} className="nv-label">
            <text x={GUT + i * CELL_PX + CELL_PX / 2} y={5.5} textAnchor="middle">
              {COLS[i]}
            </text>
            <text x={GUT - 1} y={GUT + i * CELL_PX + 6} textAnchor="end">
              {i + 1}
            </text>
          </g>
        ))}
        {Array.from({ length: SIZE * SIZE }, (_, i) => {
          const x = i % SIZE
          const y = Math.floor(i / SIZE)
          return <rect key={i} x={GUT + x * CELL_PX} y={GUT + y * CELL_PX} width={CELL_PX} height={CELL_PX} fill={(x + y) % 2 ? '#2C4352' : '#304A5A'} />
        })}
        {b.ships.map((p) => (
          <Ship key={p.id} p={p} sunk={b.sunk.some((s) => s.id === p.id)} />
        ))}
        {b.sunk
          .filter((p) => !b.ships.some((s) => s.id === p.id))
          .map((p) => (
            <Ship key={`s${p.id}`} p={p} sunk />
          ))}
        {b.preview && <Ship p={b.preview.p} ghost bad={!b.preview.ok} />}
        {b.shots.map((s) => (
          <g key={key(s)} className={lastKeys.has(key(s)) ? 'nv-new' : undefined}>
            <Pixels sprite={s.hit ? HIT : MISS} x={GUT + s.x * CELL_PX} y={GUT + s.y * CELL_PX} />
          </g>
        ))}
        {(b.picked ?? []).map((c) => (
          <rect key={`p${key(c)}`} x={GUT + c.x * CELL_PX + 1} y={GUT + c.y * CELL_PX + 1} width={CELL_PX - 2} height={CELL_PX - 2} fill="none" stroke="#FFC94A" strokeWidth={1} />
        ))}
        {b.cursor && (
          <rect x={GUT + b.cursor.x * CELL_PX + 0.5} y={GUT + b.cursor.y * CELL_PX + 0.5} width={CELL_PX - 1} height={CELL_PX - 1} fill="none" stroke="#F3EBDD" strokeWidth={0.6} strokeDasharray="1 1" />
        )}
      </svg>
    </figure>
  )
}

function usePlacement(view: NavalView, onPlace: NavalSceneProps['onPlace']) {
  const [draft, setDraft] = useState<Placement[]>(() => view.myFleet ?? [])
  const [pick, setPick] = useState<string | null>(() => FLEET.find((d) => !(view.myFleet ?? []).some((p) => p.id === d.id))?.id ?? null)
  const [dir, setDir] = useState<Dir>('h')
  const [hover, setHover] = useState<Cell | null>(null)
  const ready = view.you ? view.players[view.you.index].ready : false

  const nextFree = (ships: Placement[]) => FLEET.find((d) => !ships.some((p) => p.id === d.id))?.id ?? null
  const preview = pick && hover ? { p: { id: pick, x: hover.x, y: hover.y, dir }, ok: fits({ id: pick, x: hover.x, y: hover.y, dir }, draft) } : null

  const onCell = (c: Cell) => {
    if (pick) {
      const p = { id: pick, x: c.x, y: c.y, dir }
      if (!fits(p, draft)) return
      const next = [...draft.filter((s) => s.id !== pick), p]
      setDraft(next)
      setPick(nextFree(next))
      return
    }
    // sem navio na mão: clicar num navio pega ele de volta
    const hit = draft.find((s) =>
      Array.from({ length: shipDef(s.id)?.size ?? 0 }, (_, k) => (s.dir === 'h' ? { x: s.x + k, y: s.y } : { x: s.x, y: s.y + k })).some(
        (q) => q.x === c.x && q.y === c.y
      )
    )
    if (hit) {
      setDraft(draft.filter((s) => s.id !== hit.id))
      setPick(hit.id)
      setDir(hit.dir)
    }
  }
  return {
    draft,
    pick,
    dir,
    ready,
    preview,
    setHover,
    onCell,
    rotate: () => setDir((d) => (d === 'h' ? 'v' : 'h')),
    choose: (id: string) => {
      setDraft(draft.filter((s) => s.id !== id))
      setPick(id)
    },
    random: () => {
      setDraft(randomFleet(mathRng))
      setPick(null)
    },
    clear: () => {
      setDraft([])
      setPick(FLEET[0].id)
    },
    done: () => onPlace(draft)
  }
}

/** Batalha naval: o seu mar e o mar do outro. Na hora de posicionar, só o seu, com a lista de navios. */
export function NavalScene({ view, onPlace, onShoot }: NavalSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 900, h: 600 })
  const me = view.you?.index ?? 0
  const them = 1 - me
  const placing = view.phase === 'posicionar' && !!view.you
  const pl = usePlacement(view, onPlace)
  const myTurn = view.phase === 'batalha' && view.turn === me && !!view.you
  const [picked, setPicked] = useState<Cell[]>([])
  const [cursor, setCursor] = useState<Cell>({ x: 4, y: 4 })
  const [focused, setFocused] = useState(false)

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const fit = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])

  useEffect(() => setPicked([]), [view.ref, view.turn])

  const rotateRef = useRef(pl.rotate)
  rotateRef.current = pl.rotate
  // R gira o navio na hora de posicionar
  useEffect(() => {
    if (!placing) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        rotateRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placing])

  const shotAt = useMemo(() => new Set(view.seas[them].shots.map(key)), [view.seas, them])
  const aim = (c: Cell) => {
    if (!myTurn || shotAt.has(key(c))) return
    if (view.shots <= 1) return onShoot([c])
    setPicked((cur) => (cur.some((q) => key(q) === key(c)) ? cur.filter((q) => key(q) !== key(c)) : cur.length < view.shots ? [...cur, c] : cur))
  }
  const onEnemyKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (d[e.key]) {
      e.preventDefault()
      setFocused(true)
      setCursor((c) => ({ x: Math.min(SIZE - 1, Math.max(0, c.x + d[e.key][0])), y: Math.min(SIZE - 1, Math.max(0, c.y + d[e.key][1])) }))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setFocused(true)
      aim(cursor)
    }
  }

  // lado a lado ou um em cima do outro: o que deixar o mar maior
  const sideBySide = Math.min((box.w - 72) / 2, box.h - 110)
  const stacked = Math.min(box.w - 32, (box.h - 150) / 2)
  const wide = sideBySide >= stacked
  const size = Math.floor(placing ? Math.min(box.w - 300, box.h - 80) : Math.max(sideBySide, stacked))
  const s = Math.max(200, size)
  const name = (i: number) => view.players[i]?.name ?? 'Alguém'
  const last = view.last

  if (placing) {
    return (
      <div className="nv-scene placing" ref={hostRef}>
        <Board
          title="Seu mar"
          size={s}
          ships={pl.draft}
          sunk={[]}
          shots={[]}
          last={null}
          preview={pl.preview}
          label="Seu mar. Escolha um navio na lista e clique onde ele fica."
          onCell={pl.onCell}
          onHover={pl.setHover}
        />
        <aside className="nv-dock">
          <strong className="pixel-font">Sua frota</strong>
          <ul>
            {FLEET.map((d) => {
              const placed = pl.draft.some((p) => p.id === d.id)
              return (
                <li key={d.id}>
                  <button
                    className={`nv-pick ${pl.pick === d.id ? 'on' : ''} ${placed ? 'placed' : ''}`}
                    onClick={() => pl.choose(d.id)}
                    aria-label={`${d.name}, ${d.size} casas${placed ? ', já no mar' : ''}`}
                  >
                    <svg viewBox={`0 0 ${d.size * CELL_PX} ${CELL_PX}`} width={d.size * 12} height={12} shapeRendering="crispEdges" aria-hidden="true">
                      {runs(shipSprite(d.size)).map((r) => (
                        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
                      ))}
                    </svg>
                    <span>
                      {d.name} <small>({d.size})</small>
                    </span>
                    {placed && (
                      <span className="nv-placed" aria-hidden="true">
                        <Icon name="check" size={16} />
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          <small className="muted">Os navios não podem encostar, nem na diagonal. Clique num navio no mar para mudar ele de lugar.</small>
          <div className="nv-dock-actions">
            <button onClick={pl.rotate} data-tip="Atalho: R">
              {pl.dir === 'h' ? 'Deitado' : 'Em pé'} · girar
            </button>
            <button onClick={pl.random}>Aleatório</button>
            <button onClick={pl.clear}>Limpar</button>
            <button className="primary" disabled={pl.draft.length !== FLEET.length} onClick={pl.done}>
              {pl.ready ? 'Atualizar' : 'Pronto'}
            </button>
          </div>
        </aside>
      </div>
    )
  }

  const theirShips = view.fleets?.[them] ?? []
  return (
    <div className={`nv-scene ${wide ? 'wide' : 'tall'}`} ref={hostRef}>
      <Board
        title={view.you ? 'Seu mar' : `Mar de ${name(0)}`}
        size={s}
        ships={view.you ? (view.myFleet ?? []) : (view.fleets?.[0] ?? [])}
        sunk={view.seas[view.you ? me : 0].sunk}
        shots={view.seas[view.you ? me : 0].shots}
        last={last && last.by !== (view.you ? me : 0) ? last.cells : null}
        active={view.turn === them}
        label={`Seu mar: ${view.seas[me].afloat} navios de pé.`}
      />
      <div className="nv-enemy">
        <Board
          title={view.you ? `Mar de ${name(them)}` : `Mar de ${name(1)}`}
          size={s}
          ships={theirShips}
          sunk={view.seas[them].sunk}
          shots={view.seas[them].shots}
          last={last && last.by === me ? last.cells : null}
          picked={picked}
          cursor={myTurn && focused ? cursor : null}
          active={myTurn}
          label={`Mar de ${name(them)}. ${myTurn ? 'Clique numa casa para atirar. Setas e Enter também.' : ''}`}
          onCell={myTurn ? aim : undefined}
          onKey={myTurn ? onEnemyKey : undefined}
        />
        {myTurn && view.shots > 1 && (
          <div className="nv-salvo">
            <span>
              {picked.length} de {view.shots}: {picked.map(cellName).join(', ') || 'escolha as casas'}
            </span>
            <button className="primary" disabled={picked.length !== view.shots} onClick={() => onShoot(picked)}>
              Disparar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
