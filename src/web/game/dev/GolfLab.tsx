import { useEffect, useRef, useState, type ReactElement } from 'react'
import { apply, nextDeadline, setup, skipTo, tick, view, type GolfState } from '../../../shared/games/golf/engine'
import { MAPS } from '../../../shared/games/golf/maps'
import { isGameError, seededRng } from '../../../shared/games/types'
import { GolfHud } from '../../ui/GolfHud'
import { toneOf } from '../../ui/Avatar'
import { GolfScene } from '../golf/scene/GolfScene'

const PLAYERS = [
  { playerId: 'eu', name: 'Você' },
  { playerId: 'bot1', name: 'Bia' },
  { playerId: 'bot2', name: 'Caio' }
]
const colors = Object.fromEntries(PLAYERS.map((p) => [p.playerId, toneOf(p.name)]))
const ctx = () => ({ now: Date.now(), rng: seededRng(1) })

/**
 * Laboratório do golfe (só em dev): o motor de verdade rodando aqui mesmo, sem servidor.
 * `?map=montanha&hole=3&bots=0&collisions=0` e `window.__golf.hole(n)` / `.shoot(angle, power)`.
 */
export function GolfLab(): ReactElement {
  const q = new URLSearchParams(location.search)
  const bots = q.get('bots') !== '0'
  const [mapId, setMapId] = useState(q.get('map') ?? 'quintal')
  const [collisions, setCollisions] = useState(q.get('collisions') !== '0')
  const players = bots ? PLAYERS : PLAYERS.slice(0, 1)
  const [state, setState] = useState<GolfState>(() => {
    const s = setup(players, { mapId, collisions, holeSeconds: 120 }, ctx()).state
    return skipTo(s, Number(q.get('hole') ?? 1) - 1, Date.now()).state
  })
  const ref = useRef(state)
  ref.current = state

  const restart = (m = mapId, col = collisions, hole = 0) => {
    const s = setup(players, { mapId: m, collisions: col, holeSeconds: 120 }, ctx()).state
    setState(skipTo(s, hole, Date.now()).state)
  }

  const shoot = (playerId: string, angle: number, power: number) => {
    const s = ref.current
    const me = view(s, playerId, Date.now()).players.find((p) => p.playerId === playerId)
    if (!me) return
    const r = apply(s, playerId, { type: 'shot', hole: s.hole, stroke: me.strokes, angle, power }, ctx())
    if (isGameError(r)) console.warn(r.message)
    else setState(r.state)
  }

  // relógio do jogo: roda os prazos
  useEffect(() => {
    const t = window.setInterval(() => {
      const s = ref.current
      const d = nextDeadline(s)
      if (d !== null && d <= Date.now()) setState(tick(s, ctx()).state)
    }, 40)
    return () => window.clearInterval(t)
  }, [])

  // bots: tacam mais ou menos na direção do buraco de vez em quando
  useEffect(() => {
    if (!bots) return
    const t = window.setInterval(() => {
      const s = ref.current
      const v = view(s, null, Date.now())
      for (const id of ['bot1', 'bot2']) {
        const b = v.balls.find((x) => x.playerId === id)
        const p = v.players.find((x) => x.playerId === id)
        if (!b || !p || b.mode !== 'rest' || p.done || Math.random() < 0.6) continue
        const hole = MAPS.find((m) => m.id === v.mapId)!.holes[v.hole]
        const cup = hole.rows.findIndex((r) => r.includes('O'))
        const cx = hole.rows[cup].indexOf('O') + 0.5
        const angle = Math.atan2(cup + 0.5 - b.z, cx - b.x) + (Math.random() - 0.5) * 0.5
        shoot(id, angle, 0.25 + Math.random() * 0.5)
      }
    }, 900)
    return () => window.clearInterval(t)
  }, [bots])

  useEffect(() => {
    ;(window as unknown as { __golf: unknown }).__golf = {
      hole: (n: number) => setState((s) => skipTo(s, n - 1, Date.now()).state),
      shoot: (angle: number, power: number) => shoot('eu', angle, power),
      state: () => ref.current
    }
  })

  const v = view(state, 'eu', Date.now())
  const map = MAPS.find((m) => m.id === mapId)!
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#221C19', color: '#F3EBDD' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Laboratório do golfe</strong>
        <select
          value={mapId}
          onChange={(e) => {
            setMapId(e.target.value)
            restart(e.target.value)
          }}
        >
          {MAPS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {map.holes.map((h, i) => (
          <button key={i} className={i === state.hole ? 'primary' : ''} onClick={() => setState(skipTo(state, i, Date.now()).state)} title={h.name}>
            {i + 1}
          </button>
        ))}
        <label>
          <input
            type="checkbox"
            checked={collisions}
            onChange={(e) => {
              setCollisions(e.target.checked)
              restart(mapId, e.target.checked, state.hole)
            }}
          />{' '}
          bolas batem
        </label>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <GolfScene view={v} me="eu" colors={colors} reducedMotion={false} onShot={(a, p) => shoot('eu', a, p)} onSfx={() => undefined} />
      </div>
      <GolfHud
        view={v}
        me="eu"
        colors={colors}
        canManage
        onPlayAgain={() => restart()}
        onClose={() => restart()}
        onBackToScreens={() => undefined}
        musicOn={false}
        musicVolume={0.5}
        onMusicOn={() => undefined}
        onMusicVolume={() => undefined}
      />
    </div>
  )
}
