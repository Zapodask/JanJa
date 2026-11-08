import { useEffect, useRef, useState, type ReactElement } from 'react'
import { apply, nextDeadline, setup, tick, view, type ChessState } from '../../../shared/games/chess/engine'
import { toFen } from '../../../shared/games/chess/rules'
import type { ChessAction, ChessMinutes } from '../../../shared/games/chess/types'
import { isGameError, seededRng } from '../../../shared/games/types'
import { ChessHud } from '../../ui/ChessHud'
import { toneOf } from '../../ui/Avatar'
import { ChessScene } from '../chess/scene/ChessScene'

const PLAYERS = [
  { playerId: 'eu', name: 'Você' },
  { playerId: 'bot', name: 'Bia' }
]
const colors = Object.fromEntries(PLAYERS.map((p) => [p.playerId, toneOf(p.name)]))
const ctx = () => ({ now: Date.now(), rng: seededRng(Number(new URLSearchParams(location.search).get('seed') ?? 0)) })

/**
 * Laboratório do xadrez (só em dev): o motor de verdade rodando aqui mesmo, sem servidor.
 * `?fen=...&min=5&bot=0&seed=1` (bot=0: você joga dos dois lados) e
 * `window.__chess.move('e2', 'e4')`, `.fen()`, `.state()`.
 */
export function ChessLab(): ReactElement {
  const q = new URLSearchParams(location.search)
  const bot = q.get('bot') !== '0'
  const minutes = Number(q.get('min') ?? 0) as ChessMinutes
  const fen = q.get('fen') ?? undefined
  const fresh = () => setup(PLAYERS, { minutes }, ctx(), fen).state
  const [state, setState] = useState<ChessState>(fresh)
  const ref = useRef(state)
  ref.current = state

  // sem bot, a visão é de quem tem a vez (você joga dos dois lados)
  const actor = (s: ChessState) => (bot ? 'eu' : s.players[s.pos.turn].playerId)

  const act = (playerId: string, a: ChessAction) => {
    const r = apply(ref.current, playerId, a, ctx())
    if (isGameError(r)) console.warn(r.message)
    else setState(r.state)
  }

  // relógio: roda os prazos
  useEffect(() => {
    const t = window.setInterval(() => {
      const s = ref.current
      const d = nextDeadline(s)
      if (d !== null && d <= Date.now()) setState(tick(s, ctx()).state)
    }, 100)
    return () => window.clearInterval(t)
  }, [])

  // bot: lance aleatório, preferindo capturas
  useEffect(() => {
    if (!bot || state.result || state.players[state.pos.turn].playerId !== 'bot') return
    const t = window.setTimeout(() => {
      const v = view(ref.current, 'bot', Date.now())
      const moves = Object.entries(v.legal).flatMap(([from, tos]) => tos.map((to) => ({ from, to })))
      const caps = moves.filter((m) => v.board[m.to.charCodeAt(0) - 97 + (Number(m.to[1]) - 1) * 8] !== '.')
      const pool = caps.length && Math.random() < 0.7 ? caps : moves
      const m = pool[Math.floor(Math.random() * pool.length)]
      if (m) act('bot', { type: 'move', ...m })
    }, 600)
    return () => window.clearTimeout(t)
  }, [bot, state])

  useEffect(() => {
    ;(window as unknown as { __chess: unknown }).__chess = {
      move: (from: string, to: string, promo?: 'q' | 'r' | 'b' | 'n') => act(actor(ref.current), { type: 'move', from, to, promo }),
      fen: () => toFen(ref.current.pos),
      state: () => ref.current
    }
  })

  const me = actor(state)
  const v = view(state, me, Date.now())
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#221C19', color: '#F3EBDD' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Laboratório do xadrez</strong>
        <button onClick={() => setState(fresh())}>Recomeçar</button>
        <code style={{ fontSize: 12, color: '#B7A99A' }}>{toFen(state.pos)}</code>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <ChessScene view={v} colors={colors} reducedMotion={false} onMove={(from, to, promo) => act(me, { type: 'move', from, to, promo })} />
      </div>
      <ChessHud
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
