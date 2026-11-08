import '@fontsource-variable/pixelify-sans'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { BOARD_SIZE, GROUPS, MAX_LEVEL, TILES, sideOf } from '../../../../shared/games/tycoon/board'
import { money, type TycoonView } from '../../../../shared/games/tycoon/types'
import type { TycoonSceneProps } from '../../contract'
import { centerBox, tileBox, tokenSpot, unitOf } from './layout'
import { dieFace, HOTEL, HOUSE, ICONS, PAWN, PLAYER_COLORS, runs, type Sprite } from './pixel'

const STEP_MS = 130

function Pixels({ sprite, size, color, className }: { sprite: Sprite; size: number; color?: string; className?: string }) {
  const w = sprite[0].length
  const h = sprite.length
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} width={size} height={(size * h) / w} shapeRendering="crispEdges" aria-hidden="true">
      {runs(sprite, color).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  )
}

/** Peões andando casa por casa até a posição da visão (pulo direto quando é carta/avião ou volta). */
function useShownPositions(view: TycoonView, reducedMotion: boolean): Record<string, number> {
  const target = Object.fromEntries(view.players.map((p) => [p.playerId, p.position]))
  const [shown, setShown] = useState<Record<string, number>>(target)
  const key = view.players.map((p) => p.position).join()
  useEffect(() => {
    if (reducedMotion) return setShown(target)
    const t = window.setInterval(() => {
      setShown((cur) => {
        let moving = false
        const next: Record<string, number> = {}
        for (const [id, to] of Object.entries(target)) {
          const at = cur[id] ?? to
          const ahead = (to - at + BOARD_SIZE) % BOARD_SIZE
          if (ahead === 0) next[id] = at
          else if (ahead <= 12) {
            next[id] = (at + 1) % BOARD_SIZE
            moving = true
          } else next[id] = to
        }
        if (!moving) window.clearInterval(t)
        return next
      })
    }, STEP_MS)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reducedMotion])
  return shown
}

/** Tabuleiro do Magnata: casas em volta, peões, dados, jogadores e o histórico no meio. */
export function TycoonScene({ view, reducedMotion, onPick }: TycoonSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(560)
  const shown = useShownPositions(view, reducedMotion)

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const fit = () => setSize(Math.max(320, Math.floor(Math.min(el.clientWidth - 24, el.clientHeight - 24))))
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])

  const u = unitOf(size)
  const myTurn = !!view.you && view.turn === view.you.playerId
  const pend = view.pending
  const pickable = new Set(myTurn && pend && (pend.kind === 'festival' || pend.kind === 'voar') ? pend.tiles : [])
  const focus = pend && 'tile' in pend ? pend.tile : null
  const nameOf = (id: string) => view.players.find((p) => p.playerId === id)?.name ?? 'Alguém'
  const colorOf = (id: string) => PLAYER_COLORS[view.players.findIndex((p) => p.playerId === id) % PLAYER_COLORS.length] ?? '#B7A99A'

  const describe = (i: number): string => {
    const t = TILES[i]
    const prop = view.props[i]
    const parts = [t.name]
    if (t.kind === 'city') parts.push(`grupo ${GROUPS[t.group as number].name}`)
    if (t.price && !prop) parts.push(`à venda por ${money(t.price)}`)
    if (prop) {
      parts.push(`de ${nameOf(prop.owner)}`)
      if (t.kind === 'city') parts.push(prop.level === 0 ? 'só o terreno' : prop.level === MAX_LEVEL ? 'hotel' : `${prop.level} ${prop.level === 1 ? 'casa' : 'casas'}`)
      parts.push(`aluguel ${money(view.rents[i] ?? 0)}`)
    }
    if (view.festival === i) parts.push('com Festival')
    return parts.join(', ')
  }

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onPick(i)
    }
  }

  // peões: quantos em cada casa, para espalhar
  const byTile = new Map<number, string[]>()
  for (const p of view.players) {
    if (p.out) continue
    const at = shown[p.playerId] ?? p.position
    byTile.set(at, [...(byTile.get(at) ?? []), p.playerId])
  }
  const center = centerBox(size)
  const turnPlayer = view.players.find((p) => p.playerId === view.turn)

  return (
    <div className="ty-scene" ref={hostRef}>
      <div className="ty-board" style={{ width: size, height: size, '--u': `${u}px` } as CSSProperties}>
        {TILES.map((t, i) => {
          const b = tileBox(i, size)
          const prop = view.props[i]
          const pick = pickable.has(i)
          const side = sideOf(i)
          const style: CSSProperties = { left: b.x, top: b.y, width: b.w, height: b.h }
          if (prop) (style as Record<string, string>)['--owner'] = colorOf(prop.owner)
          if (t.kind === 'city') (style as Record<string, string>)['--group'] = GROUPS[t.group as number].color
          const icon = t.kind === 'city' ? null : ICONS[t.kind]
          return (
            <div
              key={i}
              className={`ty-tile ty-${t.kind} ty-side${side} ${prop ? 'owned' : ''} ${pick ? 'pick' : ''} ${focus === i ? 'focus' : ''} ${view.festival === i ? 'party' : ''}`}
              style={style}
              data-tip={describe(i)}
              aria-label={describe(i)}
              role={pick ? 'button' : undefined}
              tabIndex={pick ? 0 : undefined}
              onClick={pick ? () => onPick(i) : undefined}
              onKeyDown={pick ? (e) => onKey(e, i) : undefined}
            >
              {t.kind === 'city' && (
                <span className="ty-strip">
                  {prop && prop.level > 0 && prop.level < MAX_LEVEL && Array.from({ length: prop.level }, (_, k) => <Pixels key={k} sprite={HOUSE} size={u * 0.18} />)}
                  {prop?.level === MAX_LEVEL && <Pixels sprite={HOTEL} size={u * 0.26} />}
                </span>
              )}
              {icon && <Pixels sprite={icon} size={u * (i % 8 === 0 ? 0.42 : 0.3)} className="ty-icon" />}
              <span className="ty-name">{t.name}</span>
              {t.price !== undefined && <span className="ty-price pixel-font">{prop ? money(view.rents[i] ?? 0) : money(t.price)}</span>}
              {view.festival === i && <span className="ty-party pixel-font">x2</span>}
            </div>
          )
        })}

        <div className="ty-center" style={{ left: center.x, top: center.y, width: center.w, height: center.h }}>
          <strong className="ty-title pixel-font">Magnata</strong>
          <div className="ty-dice" key={view.rolls} aria-label={view.dice ? `Dados: ${view.dice[0]} e ${view.dice[1]}` : undefined}>
            {(view.dice ?? [5, 6]).map((n, k) => (
              <Pixels key={k} sprite={dieFace(n)} size={u * 0.62} className={`ty-die ${view.rolls && !reducedMotion ? 'roll' : ''} ${view.dice ? '' : 'idle'}`} />
            ))}
          </div>
          <ul className="ty-players">
            {view.players.map((p) => (
              <li key={p.playerId} className={`${p.playerId === view.turn ? 'turn' : ''} ${p.out ? 'out' : ''}`}>
                <Pixels sprite={PAWN} size={16} color={colorOf(p.playerId)} />
                <span className="ty-pname">
                  {p.name}
                  {p.playerId === view.you?.playerId ? ' (você)' : ''}
                </span>
                <span className="ty-cash pixel-font">{p.out ? 'quebrou' : money(p.cash)}</span>
                {p.jam > 0 && !p.out && <small className="detail">preso</small>}
                {p.away && !p.out && <small className="detail">fora</small>}
              </li>
            ))}
          </ul>
          <ol className="ty-log" aria-live="polite" aria-label="Histórico">
            {view.log.slice(-4).map((l, k) => (
              <li key={`${view.log.length}-${k}`}>{l}</li>
            ))}
          </ol>
          {turnPlayer && <span className="sr-only">Vez de {turnPlayer.name}.</span>}
        </div>

        {[...byTile.entries()].flatMap(([tile, ids]) =>
          ids.map((id, slot) => {
            const spot = tokenSpot(tile, slot, ids.length, size)
            const w = u * 0.34
            return (
              <span
                key={id}
                className={`ty-pawn ${id === view.turn ? 'turn' : ''}`}
                style={{ left: spot.x - w / 2, top: spot.y - w / 2, width: w, height: w }}
                aria-hidden="true"
              >
                <Pixels sprite={PAWN} size={w} color={colorOf(id)} />
              </span>
            )
          })
        )}
      </div>
    </div>
  )
}
