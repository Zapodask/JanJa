import { useEffect, useRef, useState, type ReactElement } from 'react'
import { apply, nextDeadline, setup, tick, view, type CheckersState } from '../../../shared/games/checkers/engine'
import { toText } from '../../../shared/games/checkers/rules'
import type { CheckersAction } from '../../../shared/games/checkers/types'
import type { DuelMinutes } from '../../../shared/games/duel'
import { isGameError, seededRng } from '../../../shared/games/types'
import { CheckersHud } from '../../ui/CheckersHud'
import { toneOf } from '../../ui/Avatar'
import { CheckersScene } from '../checkers/scene/CheckersScene'

const PLAYERS = [
  { playerId: 'eu', name: 'Você' },
  { playerId: 'bot', name: 'Bia' }
]
const colors = Object.fromEntries(PLAYERS.map((p) => [p.playerId, toneOf(p.name)]))
const ctx = () => ({ now: Date.now(), rng: seededRng(Number(new URLSearchParams(location.search).get('seed') ?? 0)) })

/**
 * Laboratório das damas (só em dev): o motor de verdade rodando aqui mesmo, sem servidor.
 * `?pos=<8 linhas separadas por / e a vez>&min=5&bot=0&seed=1` (bot=0: você joga dos dois lados) e
 * `window.__damas.move('c3', 'd4')`, `.pos()`, `.state()`.
 */
export function CheckersLab(): ReactElement {
  const q = new URLSearchParams(location.search)
  const bot = q.get('bot') !== '0'
  const minutes = Number(q.get('min') ?? 0) as DuelMinutes
  const text = q.get('pos') ?? undefined
  const fresh = () => setup(PLAYERS, { minutes }, ctx(), text).state
  const [state, setState] = useState<CheckersState>(fresh)
  const ref = useRef(state)
  ref.current = state

  const actor = (s: CheckersState) => (bot ? 'eu' : s.players[s.pos.turn].playerId)
  const act = (playerId: string, a: CheckersAction) => {
    const r = apply(ref.current, playerId, a, ctx())
    if (isGameError(r)) console.warn(r.message)
    else setState(r.state)
  }

  useEffect(() => {
    const t = window.setInterval(() => {
      const s = ref.current
      const d = nextDeadline(s)
      if (d !== null && d <= Date.now()) setState(tick(s, ctx()).state)
    }, 100)
    return () => window.clearInterval(t)
  }, [])

  // bot: lance aleatório entre os legais
  useEffect(() => {
    if (!bot || state.result || state.players[state.pos.turn].playerId !== 'bot') return
    const t = window.setTimeout(() => {
      const legal = view(ref.current, 'bot', Date.now()).legal
      const path = legal[Math.floor(Math.random() * legal.length)]
      if (path) act('bot', { type: 'move', path })
    }, 600)
    return () => window.clearTimeout(t)
  }, [bot, state])

  useEffect(() => {
    ;(window as unknown as { __damas: unknown }).__damas = {
      move: (...path: string[]) => act(actor(ref.current), { type: 'move', path }),
      pos: () => toText(ref.current.pos),
      state: () => ref.current
    }
  })

  const me = actor(state)
  const v = view(state, me, Date.now())
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#221C19', color: '#F3EBDD' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Laboratório das damas</strong>
        <button onClick={() => setState(fresh())}>Recomeçar</button>
        <code style={{ fontSize: 12, color: '#B7A99A' }}>{toText(state.pos)}</code>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <CheckersScene view={v} colors={colors} reducedMotion={false} onMove={(path) => act(me, { type: 'move', path })} />
      </div>
      <CheckersHud
        view={v}
        canManage
        onAct={(a) => act(me, a)}
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
