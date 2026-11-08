import { useEffect, useRef, useState, type ReactElement } from 'react'
import { apply, nextDeadline, setup, tick, view, type NavalState } from '../../../shared/games/naval/engine'
import { randomFleet, SIZE, type Cell } from '../../../shared/games/naval/fleet'
import type { NavalAction, NavalMode } from '../../../shared/games/naval/types'
import { isGameError, type Rng } from '../../../shared/games/types'
import { NavalHud } from '../../ui/NavalHud'
import { NavalScene } from '../naval/scene/NavalScene'

const PLAYERS = [
  { playerId: 'eu', name: 'Você' },
  { playerId: 'bot', name: 'Bia' }
]
const rng: Rng = { int: (max) => Math.floor(Math.random() * max) }
const ctx = () => ({ now: Date.now(), rng })

/**
 * Laboratório da batalha naval (só em dev): o motor rodando aqui contra um bot que atira ao acaso.
 * `?mode=salva` e `window.__naval.ready()` (posiciona a sua frota ao acaso), `.state()`.
 */
export function NavalLab(): ReactElement {
  const mode: NavalMode = new URLSearchParams(location.search).get('mode') === 'salva' ? 'salva' : 'classico'
  const fresh = () => {
    const s = setup(PLAYERS, { mode }, ctx()).state
    const r = apply(s, 'bot', { type: 'place', ships: randomFleet(rng) }, ctx())
    return isGameError(r) ? s : r.state
  }
  const [state, setState] = useState<NavalState>(fresh)
  const ref = useRef(state)
  ref.current = state
  const act = (id: string, a: NavalAction) => {
    const r = apply(ref.current, id, a, ctx())
    if (isGameError(r)) console.warn(r.message)
    else setState(r.state)
  }

  useEffect(() => {
    const t = window.setInterval(() => {
      const s = ref.current
      const d = nextDeadline(s)
      if (d !== null && d <= Date.now()) setState(tick(s, ctx()).state)
    }, 200)
    return () => window.clearInterval(t)
  }, [])

  // bot atira ao acaso na vez dele
  useEffect(() => {
    if (state.phase !== 'batalha' || state.turn !== 1) return
    const t = window.setTimeout(() => {
      const v = view(ref.current, 'bot', Date.now())
      const used = new Set(v.seas[0].shots.map((c) => `${c.x},${c.y}`))
      const free: Cell[] = []
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (!used.has(`${x},${y}`)) free.push({ x, y })
      const cells = Array.from({ length: v.shots }, () => free.splice(rng.int(free.length), 1)[0])
      act('bot', { type: 'shoot', cells, ref: v.ref })
    }, 700)
    return () => window.clearTimeout(t)
  }, [state])

  useEffect(() => {
    ;(window as unknown as { __naval: unknown }).__naval = {
      ready: () => act('eu', { type: 'place', ships: randomFleet(rng) }),
      state: () => ref.current
    }
  })

  const v = view(state, 'eu', Date.now())
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#221C19', color: '#F3EBDD' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center' }}>
        <strong>Laboratório da batalha naval</strong>
        <button onClick={() => setState(fresh())}>Recomeçar</button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <NavalScene
          key={state.phase === 'posicionar' ? 'p' : 'b'}
          view={v}
          reducedMotion={false}
          onPlace={(ships) => act('eu', { type: 'place', ships })}
          onShoot={(cells) => act('eu', { type: 'shoot', cells, ref: v.ref })}
        />
      </div>
      <NavalHud
        view={v}
        canManage
        onPlayAgain={() => setState(fresh())}
        onClose={() => setState(fresh())}
        onBackToScreens={() => undefined}
        musicOn={false}
        musicVolume={0.5}
        onMusicOn={() => undefined}
        onMusicVolume={() => undefined}
      />
    </div>
  )
}
