import { useEffect, useRef, useState, type ReactElement } from 'react'
import { apply, nextDeadline, setup, tick, view, withHands, type TrucoState } from '../../../shared/games/truco/engine'
import type { TrucoAction, TrucoEvent, TrucoIntent, TrucoPlayers } from '../../../shared/games/truco/types'
import { isGameError, type Rng } from '../../../shared/games/types'
import { TrucoHud } from '../../ui/TrucoHud'
import { TrucoScene } from '../truco/scene/TrucoScene'
import type { RawEventBatch } from '../contract'

const NAMES = ['Você', 'Bia', 'Caio', 'Duda', 'Edu', 'Flor']
const rng: Rng = { int: (max) => Math.floor(Math.random() * max) }
const ctx = () => ({ now: Date.now(), rng })

/** Bot simples: escolhe ao acaso entre o que o jogo oferece (menos ir ao baralho, que é raro). */
function botAction(s: TrucoState, id: string): TrucoAction | null {
  const v = view(s, id, Date.now())
  const c = v.can
  const m = v.mesas.find((x) => x.id === v.myMesa)
  if (!c || !m) return null
  const ref = m.ref
  const opts: TrucoAction[] = []
  if (c.play) for (const card of v.myCards) opts.push({ type: 'play', card, ref }, { type: 'play', card, ref })
  if (c.truco !== null && Math.random() < 0.3) opts.push({ type: 'truco', ref })
  if (c.envido.length && Math.random() < 0.3) opts.push({ type: 'envido', kind: c.envido[0], ref })
  if (c.quero) opts.push({ type: 'quero', ref })
  if (c.naoquero) opts.push({ type: 'naoquero', ref })
  if (c.contraflor) opts.push({ type: 'contraflor', ref })
  return opts.length ? opts[Math.floor(Math.random() * opts.length)] : null
}

/**
 * Laboratório do truco (só em dev): o motor rodando aqui, com bots.
 * `?n=4` (2, 4 ou 6) e `window.__truco.hands([['1e','7e','3c'], ...])` (mão combinada, por cadeira),
 * `.score(nos, eles)`, `.next()` (próxima mão), `.state()`.
 */
export function TrucoLab(): ReactElement {
  const q = new URLSearchParams(location.search)
  const n = ([2, 4, 6].includes(Number(q.get('n'))) ? Number(q.get('n')) : 4) as TrucoPlayers
  const players = NAMES.slice(0, n).map((name, i) => ({ playerId: i === 0 ? 'eu' : `bot${i}`, name }))
  const fresh = () => setup(players, { players: n }, ctx()).state
  const [state, setState] = useState<TrucoState>(fresh)
  const [events, setEvents] = useState<RawEventBatch | null>(null)
  const seq = useRef(0)
  const ref = useRef(state)
  ref.current = state

  const commit = (next: TrucoState, evs: TrucoEvent[]) => {
    setState(next)
    if (evs.length) setEvents({ seq: ++seq.current, events: evs })
  }
  const act = (id: string, a: TrucoAction) => {
    const r = apply(ref.current, id, a, ctx())
    if (isGameError(r)) console.warn(r.message)
    else commit(r.state, r.events)
  }

  useEffect(() => {
    const t = window.setInterval(() => {
      const s = ref.current
      const d = nextDeadline(s)
      if (d !== null && d <= Date.now()) {
        const r = tick(s, ctx())
        commit(r.state, r.events)
      }
    }, 200)
    return () => window.clearInterval(t)
  }, [])

  // bots
  useEffect(() => {
    const t = window.setTimeout(() => {
      for (const p of players.slice(1)) {
        const a = botAction(ref.current, p.playerId)
        if (a) return act(p.playerId, a)
      }
    }, 900)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    ;(window as unknown as { __truco: unknown }).__truco = {
      hands: (h: string[][]) => setState((s) => withHands(s, h, Date.now())),
      score: (a: number, b: number) => setState((s) => ({ ...s, score: [a, b] })),
      next: () => setState((s) => tick({ ...s, phase: 'intervalo', until: 0 }, ctx()).state),
      state: () => ref.current
    }
  })

  const v = view(state, 'eu', Date.now())
  const mine = (a: TrucoIntent) => {
    const m = v.mesas.find((x) => x.id === v.myMesa)
    if (m) act('eu', { ...a, ref: m.ref } as TrucoAction)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#221C19', color: '#F3EBDD' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center' }}>
        <strong>Laboratório do truco</strong>
        <button onClick={() => setState(fresh())}>Recomeçar</button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <TrucoScene view={v} lastEvents={events} reducedMotion={false} onPlay={(card) => mine({ type: 'play', card })} />
      </div>
      <TrucoHud
        view={v}
        canManage
        onAct={mine}
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
