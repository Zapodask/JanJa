import { useEffect, useRef, useState, type ReactElement } from 'react'
import { botAction } from '../../../shared/games/mystery/bot'
import { apply, nextDeadline, setup, tick, view, type MysteryState } from '../../../shared/games/mystery/engine'
import type { MysteryAction } from '../../../shared/games/mystery/types'
import { isGameError, type Rng } from '../../../shared/games/types'
import { MysteryHud } from '../../ui/MysteryHud'
import { MysteryScene } from '../mystery/scene/MysteryScene'

const NAMES = ['Você', 'Bia', 'Caio', 'Duda', 'Edu', 'Flor']
const rng: Rng = { int: (max) => Math.floor(Math.random() * max) }
const ctx = () => ({ now: Date.now(), rng })

/** Laboratório do Mistério (só em dev): o motor aqui, com bots que deduzem. `?n=4` e `window.__misterio.state()`. */
export function MysteryLab(): ReactElement {
  const n = Math.min(6, Math.max(2, Number(new URLSearchParams(location.search).get('n') ?? 4)))
  const players = NAMES.slice(0, n).map((name, i) => ({ playerId: i ? `bot${i}` : 'eu', name }))
  const fresh = () => setup(players, {}, ctx()).state
  const [state, setState] = useState<MysteryState>(fresh)
  const ref = useRef(state)
  ref.current = state
  const act = (id: string, a: MysteryAction) => {
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

  useEffect(() => {
    const t = window.setTimeout(() => {
      for (const p of players.slice(1)) {
        const a = botAction(view(ref.current, p.playerId, Date.now()), rng)
        if (a) return act(p.playerId, a)
      }
    }, 900)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    ;(window as unknown as { __misterio: unknown }).__misterio = { state: () => ref.current }
  })

  const v = view(state, 'eu', Date.now())
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#221C19', color: '#F3EBDD' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center' }}>
        <strong>Laboratório do Mistério</strong>
        <button onClick={() => setState(fresh())}>Recomeçar</button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <MysteryScene view={v} reducedMotion={false} onAct={(a) => act('eu', a)} />
      </div>
      <MysteryHud
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
