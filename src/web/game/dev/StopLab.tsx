import { useEffect, useRef, useState, type ReactElement } from 'react'
import { DEFAULT_CATEGORIES } from '../../../shared/games/stop/categories'
import { apply, nextDeadline, setup, tick, view, type StopState } from '../../../shared/games/stop/engine'
import type { Answers, StopAction } from '../../../shared/games/stop/types'
import { isGameError, type Rng } from '../../../shared/games/types'
import { StopHud } from '../../ui/StopHud'
import { StopScene } from '../stop/scene/StopScene'

const NAMES = ['Você', 'Bia', 'Caio', 'Duda']
const rng: Rng = { int: (max) => Math.floor(Math.random() * max) }
const ctx = () => ({ now: Date.now(), rng })
const SYL = ['ra', 'lo', 'mi', 'ta', 'ne', 'ca', 'zu', 'ri']
const fake = (letter: string) => letter + SYL[rng.int(SYL.length)] + SYL[rng.int(SYL.length)]

/**
 * Laboratório do Stop (só em dev): o motor aqui, com bots que escrevem palavras inventadas com a letra.
 * `?n=4&s=60` e `window.__stop.state()`.
 */
export function StopLab(): ReactElement {
  const q = new URLSearchParams(location.search)
  const n = Math.min(4, Math.max(2, Number(q.get('n') ?? 3)))
  const seconds = (Number(q.get('s') ?? 60) || 0) as 0 | 60
  const players = NAMES.slice(0, n).map((name, i) => ({ playerId: i ? `bot${i}` : 'eu', name }))
  const fresh = () => setup(players, { categories: [...DEFAULT_CATEGORIES], rounds: 5, seconds }, ctx()).state
  const [state, setState] = useState<StopState>(fresh)
  const ref = useRef(state)
  ref.current = state
  const act = (id: string, a: StopAction) => {
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

  // bots: escrevem uma categoria a cada pouco; às vezes gritam STOP; na conferência votam e dão pronto
  useEffect(() => {
    const t = window.setInterval(() => {
      const s = ref.current
      for (const p of players.slice(1)) {
        const mine: Answers = { ...(s.answers[p.playerId] ?? {}) }
        if (s.phase === 'escrevendo' || s.phase === 'parando') {
          const empty = s.options.categories.filter((c) => !mine[c])
          if (empty.length && rng.int(3) === 0) {
            mine[empty[0]] = fake(s.letter)
            act(p.playerId, { type: 'write', round: s.round, answers: mine })
          } else if (!empty.length && s.phase === 'escrevendo' && rng.int(6) === 0) act(p.playerId, { type: 'stop', round: s.round, answers: mine })
        } else if (s.phase === 'conferindo' && !s.ready.includes(p.playerId)) {
          if (rng.int(4) === 0) act(p.playerId, { type: 'vote', round: s.round, target: 'eu', category: s.options.categories[rng.int(s.options.categories.length)], invalid: true })
          else if (rng.int(3) === 0) act(p.playerId, { type: 'ready', round: s.round })
        }
      }
    }, 700)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    ;(window as unknown as { __stop: unknown }).__stop = { state: () => ref.current }
  })

  const v = view(state, 'eu', Date.now())
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#221C19', color: '#F3EBDD' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center' }}>
        <strong>Laboratório do Stop</strong>
        <button onClick={() => setState(fresh())}>Recomeçar</button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <StopScene view={v} onAct={(a) => act('eu', a)} />
      </div>
      <StopHud
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
