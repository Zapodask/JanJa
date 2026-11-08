import { useEffect, useRef, useState, type ReactElement } from 'react'
import { apply, autoShot, nextDeadline, setup, tick, view, type PoolState } from '../../../shared/games/pool/engine'
import type { PoolAction } from '../../../shared/games/pool/types'
import { isGameError, type Rng } from '../../../shared/games/types'
import { PoolHud } from '../../ui/PoolHud'
import { PoolScene } from '../pool/scene/PoolScene'

const PLAYERS = [
  { playerId: 'eu', name: 'Você' },
  { playerId: 'bot', name: 'Bia' }
]
const rng: Rng = { int: (max) => Math.floor(Math.random() * max) }
const ctx = () => ({ now: Date.now(), rng })

/**
 * Laboratório da sinuca (só em dev): o motor aqui, contra um bot que mira na bola mais perto.
 * `?bot=0` (você joga dos dois lados) e `window.__sinuca.state()`, `.set(state)`.
 */
export function PoolLab(): ReactElement {
  const bot = new URLSearchParams(location.search).get('bot') !== '0'
  const fresh = () => setup(PLAYERS, {}, ctx()).state
  const [state, setState] = useState<PoolState>(fresh)
  const ref = useRef(state)
  ref.current = state
  const me = bot ? 'eu' : state.players[state.turn].playerId
  const act = (id: string, a: PoolAction) => {
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

  // bot: espera a animação e taca na bola mais perto, com força variada
  useEffect(() => {
    if (!bot || state.winner !== null || state.turn !== 1) return
    const t = window.setTimeout(() => {
      const a = autoShot(ref.current)
      act('bot', { ...a, power: 0.35 + Math.random() * 0.5 })
    }, 4500)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    ;(window as unknown as { __sinuca: unknown }).__sinuca = { state: () => ref.current, set: (s: PoolState) => setState(s) }
  })

  const v = view(state, me, Date.now())
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#221C19', color: '#F3EBDD' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center' }}>
        <strong>Laboratório da sinuca</strong>
        <button onClick={() => setState(fresh())}>Recomeçar</button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <PoolScene view={v} reducedMotion={false} onShoot={(shot) => act(me, { type: 'shoot', ...shot, ref: v.ref })} />
      </div>
      <PoolHud
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
