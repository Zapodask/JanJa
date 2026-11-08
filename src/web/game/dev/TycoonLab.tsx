import { useEffect, useRef, useState, type ReactElement } from 'react'
import { apply, nextDeadline, setup, tick, view, type TycoonState } from '../../../shared/games/tycoon/engine'
import type { TycoonAction, TycoonMinutes } from '../../../shared/games/tycoon/types'
import { isGameError, seededRng, type Rng } from '../../../shared/games/types'
import { TycoonHud } from '../../ui/TycoonHud'
import { TycoonScene } from '../tycoon/scene/TycoonScene'

const ALL = [
  { playerId: 'eu', name: 'Você' },
  { playerId: 'bot1', name: 'Bia' },
  { playerId: 'bot2', name: 'Caio' },
  { playerId: 'bot3', name: 'Duda' },
  { playerId: 'bot4', name: 'Enzo' },
  { playerId: 'bot5', name: 'Flor' }
]
const rng: Rng = { int: (max) => Math.floor(Math.random() * max) }
const ctx = () => ({ now: Date.now(), rng })

/** Bot simples: compra quando sobra dinheiro, constrói às vezes, toma cidade quando dá. */
function botAction(s: TycoonState, id: string): TycoonAction {
  const v = view(s, id, Date.now())
  const p = v.pending
  const cash = v.players.find((x) => x.playerId === id)?.cash ?? 0
  if (!p) return { type: 'pass' }
  switch (p.kind) {
    case 'rolar':
      return { type: 'roll', ...(p.jammed && cash > 600 ? { pay: true } : {}) }
    case 'comprar': {
      const ok = p.options.filter((o) => cash - o.cost > 250)
      return ok.length ? { type: 'buy', level: ok[ok.length - 1].level } : { type: 'pass' }
    }
    case 'construir': {
      const ok = p.options.filter((o) => cash - o.cost > 300)
      return ok.length ? { type: 'build', level: ok[ok.length - 1].level } : { type: 'pass' }
    }
    case 'tomar':
      return cash - p.price > 300 ? { type: 'takeover' } : { type: 'pass' }
    case 'festival':
      return { type: 'festival', tile: p.tiles[p.tiles.length - 1] }
    case 'voar':
      return { type: 'pass' }
  }
}

/**
 * Laboratório do Magnata (só em dev): o motor rodando aqui, com bots.
 * `?bots=3&min=15&seed=1` e `window.__magnata.give(tile, 'eu', nivel)`, `.place(casa)`, `.state()`.
 */
export function TycoonLab(): ReactElement {
  const q = new URLSearchParams(location.search)
  const bots = Math.min(5, Math.max(1, Number(q.get('bots') ?? 3)))
  const minutes = Number(q.get('min') ?? 0) as TycoonMinutes
  const players = ALL.slice(0, bots + 1)
  const fresh = () => setup(players, { minutes }, { now: Date.now(), rng: seededRng(Number(q.get('seed') ?? 1)) }).state
  const [state, setState] = useState<TycoonState>(fresh)
  const ref = useRef(state)
  ref.current = state

  const act = (id: string, a: TycoonAction) => {
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

  // bots jogam a vez deles
  useEffect(() => {
    const id = state.players[state.turn]?.playerId
    if (state.result || !id || id === 'eu') return
    const t = window.setTimeout(() => act(id, botAction(ref.current, id)), 700)
    return () => window.clearTimeout(t)
  }, [state])

  useEffect(() => {
    ;(window as unknown as { __magnata: unknown }).__magnata = {
      place: (pos: number, id = 'eu') =>
        setState((s) => ({ ...s, players: s.players.map((p) => (p.playerId === id ? { ...p, position: pos } : p)) })),
      give: (tile: number, owner = 'eu', level = 0) => setState((s) => ({ ...s, props: { ...s.props, [tile]: { owner, level } } })),
      state: () => ref.current
    }
  })

  const v = view(state, 'eu', Date.now())
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#221C19', color: '#F3EBDD' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center' }}>
        <strong>Laboratório do Magnata</strong>
        <button onClick={() => setState(fresh())}>Recomeçar</button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <TycoonScene
          view={v}
          reducedMotion={false}
          onPick={(tile) => {
            const kind = v.pending?.kind
            if (kind === 'festival') act('eu', { type: 'festival', tile })
            if (kind === 'voar') act('eu', { type: 'fly', tile })
          }}
        />
      </div>
      <TycoonHud
        view={v}
        canManage
        onAct={(a) => act('eu', a)}
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
