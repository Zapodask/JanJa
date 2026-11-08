import '@fontsource-variable/pixelify-sans'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { MAX_HP, WEAPONS, GRENADE, type ScoreLine, type ShooterView, type WeaponId } from '../../shared/games/shooter/types'
import type { FrameEvent, NetStatus, ShooterFrame, ShooterSession } from '../game/shooter/contract'
import { CALL_MS, DASH_COOLDOWN_MS, FEED_MS, MULTI_WINDOW_MS, RESPAWN_S, ammoText, callFor, netLabel, podiumOf } from '../game/shooter/hudLogic'
import { SPAL, rowsToCanvas } from '../game/shooter/scene/palette'
import { weaponIconRows } from '../game/shooter/scene/sprites'
import { formatClock } from '../game/helpers'
import { Icon } from './icons'
import { VolumeSlider } from './media'
import { Jan } from './Pixel'

export interface ShooterHudProps {
  session: ShooterSession
  /** visão do coordenador; no laboratório pode faltar */
  view?: ShooterView
  /** meu playerId (ou null, espectador) */
  you: string | null
  colors: Record<string, string>
  canManage: boolean
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens?: () => void
  musicOn?: boolean
  musicVolume?: number
  onMusicOn?: (on: boolean) => void
  onMusicVolume?: (v: number) => void
  /** nomes por playerId (se a view não vier) */
  names?: Record<string, string>
  /** miniatura/destaque: o HUD some */
  hidden?: boolean
}

// ---------------------------------------------------------------- ícones de arma (pixel art em <img>)

const iconCache = new Map<string, string>()
function iconUrl(w: WeaponId | 'granada', scale = 2): string {
  const key = `${w}|${scale}`
  const hit = iconCache.get(key)
  if (hit) return hit
  const small = rowsToCanvas(weaponIconRows(w), SPAL)
  const cv = document.createElement('canvas')
  cv.width = small.width * scale
  cv.height = small.height * scale
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small, 0, 0, cv.width, cv.height)
  const url = cv.toDataURL()
  iconCache.set(key, url)
  return url
}

export function WeaponIcon({ weapon, scale = 2 }: { weapon: WeaponId | 'granada'; scale?: number }): ReactElement {
  const url = useMemo(() => iconUrl(weapon, scale), [weapon, scale])
  return <img className="tiro-wicon" src={url} alt="" draggable={false} />
}

// ---------------------------------------------------------------- estado lido do quadro (10 vezes por segundo)

interface Snap {
  phase: ShooterFrame['phase']
  timeLeftMs: number
  killLimit: number
  me: { slot: number; hp: number; alive: boolean; weapon: WeaponId; ammo: number; grenades: number } | null
  scores: ScoreLine[]
  names: Record<string, string>
  slots: Record<number, { id: string; name: string }>
  net: NetStatus
  pingMs: number
}

function snapOf(f: ShooterFrame | null): Snap | null {
  if (!f) return null
  const me = f.players.find((p) => p.slot === f.me)
  const names: Record<string, string> = {}
  const slots: Snap['slots'] = {}
  for (const p of f.players) {
    names[p.id] = p.name
    slots[p.slot] = { id: p.id, name: p.name }
  }
  return {
    phase: f.phase,
    timeLeftMs: f.timeLeftMs,
    killLimit: f.killLimit,
    me: me ? { slot: me.slot, hp: me.hp, alive: me.alive, weapon: me.weapon, ammo: me.ammo, grenades: me.grenades } : null,
    scores: f.scores,
    names,
    slots,
    net: f.net,
    pingMs: f.pingMs
  }
}

const sigOf = (s: Snap | null): string =>
  s
    ? [
        s.phase,
        Math.ceil(s.timeLeftMs / 1000),
        s.killLimit,
        s.me ? `${s.me.hp}|${s.me.alive}|${s.me.weapon}|${s.me.ammo}|${s.me.grenades}` : '-',
        s.scores.map((x) => `${x.id}:${x.kills}:${x.deaths}:${Math.round(x.damage)}`).join(','),
        Object.values(s.names).join(','),
        s.net,
        Math.round(s.pingMs / 5)
      ].join('#')
    : ''

function useSnap(session: ShooterSession): Snap | null {
  const [snap, setSnap] = useState<Snap | null>(() => snapOf(session.frame()))
  const last = useRef('')
  useEffect(() => {
    const read = () => {
      const s = snapOf(session.frame())
      const sig = sigOf(s)
      if (sig !== last.current) {
        last.current = sig
        setSnap(s)
      }
    }
    read()
    const t = window.setInterval(read, 100)
    return () => window.clearInterval(t)
  }, [session])
  return snap
}

interface FeedItem {
  id: number
  killer: string
  victim: string
  weapon: WeaponId | 'granada'
  mine: boolean
  died: boolean
  at: number
}

interface Call {
  id: number
  text: string
  who: string
  mine: boolean
}

// ---------------------------------------------------------------- componentes

function StatBar({ value, max, tone }: { value: number; max: number; tone: 'hp' | 'dash' }): ReactElement {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <span className={`tiro-bar ${tone}`} aria-hidden="true">
      <i style={{ width: `${pct}%` }} />
    </span>
  )
}

function Scoreboard({ snap, you, colors, title }: { snap: Snap; you: string | null; colors: Record<string, string>; title: string }): ReactElement {
  return (
    <div className="tiro-board pixel-font" role="dialog" aria-label={title}>
      <strong>{title}</strong>
      <table>
        <thead>
          <tr>
            <th scope="col">Jogador</th>
            <th scope="col">Abates</th>
            <th scope="col">Mortes</th>
            <th scope="col">Dano</th>
          </tr>
        </thead>
        <tbody>
          {snap.scores.map((s) => (
            <tr key={s.id} className={s.id === you ? 'me' : ''}>
              <th scope="row">
                <i className="golf-dot" style={{ background: colors[s.id] ?? SPAL.d }} aria-hidden="true" />
                {snap.names[s.id] ?? 'Jogador'}
              </th>
              <td>{s.kills}</td>
              <td>{s.deaths}</td>
              <td>{Math.round(s.damage)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const HELP: { title: string; lines: string[] }[] = [
  { title: 'Teclado e mouse', lines: ['WASD anda e o mouse mira.', 'Clique atira (segure para atirar sem parar).', 'Espaço dá um dash.', 'Q ou botão direito joga granada.', 'Tab mostra o placar.'] },
  { title: 'Controle', lines: ['Analógico esquerdo anda e o direito mira.', 'Gatilho direito atira e o esquerdo joga granada.', 'A ou LB dá um dash.'] },
  { title: 'Celular', lines: ['O joystick da esquerda anda.', 'O da direita mira e atira quando você empurra até a borda.', 'Os botões Dash e Granada ficam no canto.'] }
]

export function ShooterHud(p: ShooterHudProps): ReactElement | null {
  const { session, view, you, colors } = p
  const snap = useSnap(session)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [call, setCall] = useState<Call | null>(null)
  const [board, setBoard] = useState(false)
  const [help, setHelp] = useState(false)
  const [deadAt, setDeadAt] = useState<number | null>(null)
  const [dashAt, setDashAt] = useState<number | null>(null)
  const [, tick] = useState(0)
  const seq = useRef(0)
  const kills = useRef(new Map<number, number[]>())
  const meSlot = snap?.me?.slot ?? null
  const meRef = useRef(meSlot)
  meRef.current = meSlot
  const slotsRef = useRef<Snap['slots']>({})
  if (snap) slotsRef.current = snap.slots

  // eventos: feed, narração, morte e dash
  useEffect(() => {
    return session.onEvents((evs: FrameEvent[]) => {
      const now = performance.now()
      for (const e of evs) {
        if (e.type === 'dash' && e.slot === meRef.current) setDashAt(now)
        if (e.type === 'spawn' && e.slot === meRef.current) setDeadAt(null)
        if (e.type !== 'kill') continue
        const s = slotsRef.current
        const killer = s[e.killer]?.name ?? '?'
        const victim = s[e.victim]?.name ?? '?'
        const mine = e.killer === meRef.current
        const died = e.victim === meRef.current
        if (died) setDeadAt(now)
        const id = ++seq.current
        setFeed((f) => [...f.slice(-4), { id, killer, victim, weapon: e.weapon, mine, died, at: now }])
        if (e.killer !== e.victim) {
          const list = (kills.current.get(e.killer) ?? []).filter((t) => now - t < MULTI_WINDOW_MS)
          list.push(now)
          kills.current.set(e.killer, list)
          const text = callFor(list.length, e.streak)
          if (text) setCall({ id: ++seq.current, text, who: killer, mine })
        }
      }
    })
  }, [session])

  // limpa o feed e a narração; relógio local para "Volta em 3" e o dash
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = performance.now()
      setFeed((f) => (f.some((x) => now - x.at > FEED_MS) ? f.filter((x) => now - x.at <= FEED_MS) : f))
      tick((n) => n + 1)
    }, 200)
    return () => window.clearInterval(t)
  }, [])
  useEffect(() => {
    if (!call) return
    const t = window.setTimeout(() => setCall((c) => (c && c.id === call.id ? null : c)), CALL_MS)
    return () => window.clearTimeout(t)
  }, [call])

  // Tab segura o placar (sem atrapalhar quem digita no chat)
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
    }
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || typing(e.target) || e.ctrlKey || e.altKey || e.metaKey) return
      e.preventDefault()
      setBoard(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Tab') setBoard(false)
    }
    const off = () => setBoard(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', off)
    }
  }, [])

  const toggleHelp = useCallback(() => setHelp((h) => !h), [])
  if (p.hidden) return null
  if (!snap) {
    return (
      <div className="tiro-hud" aria-live="polite">
        <div className="tiro-wait pixel-font">Conectando à partida…</div>
      </div>
    )
  }

  const now = performance.now()
  const warm = snap.phase === 'aquecendo'
  const over = snap.phase === 'fim' || view?.phase === 'fim'
  const lead = snap.scores[0]
  const me = snap.me
  const respawnLeft = deadAt !== null && me && !me.alive ? Math.max(1, Math.ceil(RESPAWN_S - (now - deadAt) / 1000)) : null
  const dashLeft = dashAt !== null ? Math.max(0, DASH_COOLDOWN_MS - (now - dashAt)) : 0
  const final = snap.phase === 'jogando' && snap.timeLeftMs <= 60_000
  const ranking: ScoreLine[] = view?.ranking ?? snap.scores
  const names = { ...snap.names, ...(p.names ?? {}), ...Object.fromEntries((view?.players ?? []).map((x) => [x.id, x.name])) }
  const { top, rest } = podiumOf(ranking)
  const youWon = over && ranking[0]?.id === you

  return (
    <div className={`tiro-hud ${final ? 'final' : ''}`}>
      <div className="sr-only" aria-live="polite">
        {call ? `${call.who}: ${call.text}` : ''}
        {warm ? `Aquecendo: ${Math.ceil(snap.timeLeftMs / 1000)}` : ''}
      </div>

      {/* topo: relógio e limite de abates */}
      <div className="tiro-top pixel-font">
        {warm ? (
          <div className="tiro-warm">
            <strong>Aquecendo: {Math.max(0, Math.ceil(snap.timeLeftMs / 1000))}</strong>
            <small>Ainda não vale ponto</small>
          </div>
        ) : (
          <div className={`tiro-clock ${final ? 'hurry' : ''}`}>
            <strong>{formatClock(snap.timeLeftMs)}</strong>
            <small>
              {lead?.kills ?? 0} de {snap.killLimit} abates
            </small>
          </div>
        )}
      </div>

      {/* kill feed */}
      <ul className="tiro-feed pixel-font" aria-label="Últimos abates">
        {feed.map((f) => (
          <li key={f.id} className={f.mine ? 'mine' : f.died ? 'died' : ''}>
            <span className="who">{f.killer}</span>
            <WeaponIcon weapon={f.weapon} />
            <span className="who">{f.victim}</span>
          </li>
        ))}
      </ul>

      {/* narração do Jan */}
      {call && !over && (
        <div className={`tiro-call pixel-font ${call.mine ? 'mine' : ''}`} key={call.id}>
          <Jan pose="idle" size={32} ground={false} />
          <span>
            <strong>{call.text}</strong>
            <small>{call.mine ? 'Você' : call.who}</small>
          </span>
        </div>
      )}

      {/* renascer */}
      {respawnLeft !== null && !over && (
        <div className="tiro-respawn pixel-font" role="status">
          <strong>Volta em {respawnLeft}</strong>
        </div>
      )}

      {/* vida, arma, granadas e dash */}
      {me && !over && (
        <div className={`tiro-me pixel-font ${me.alive ? '' : 'dead'}`}>
          <div className="tiro-hp" role="meter" aria-label="Vida" aria-valuemin={0} aria-valuemax={MAX_HP} aria-valuenow={Math.max(0, Math.round(me.hp))}>
            <span className="num">{Math.max(0, Math.round(me.hp))}</span>
            <StatBar value={me.hp} max={MAX_HP} tone="hp" />
          </div>
          <div className="tiro-gun" aria-label={`${WEAPONS[me.weapon].name}, munição ${ammoText(me.weapon, me.ammo)}`}>
            <WeaponIcon weapon={me.weapon} scale={3} />
            <span className="num">{ammoText(me.weapon, me.ammo)}</span>
            <span className="tiro-nades" aria-label={`Granadas: ${me.grenades} de ${GRENADE.maxCarry}`}>
              <WeaponIcon weapon="granada" scale={2} />
              <span className="num">{me.grenades}</span>
            </span>
          </div>
          <div className="tiro-dash" aria-label={dashLeft > 0 ? 'Dash recarregando' : 'Dash pronto'}>
            <span>Dash</span>
            <StatBar value={DASH_COOLDOWN_MS - dashLeft} max={DASH_COOLDOWN_MS} tone="dash" />
          </div>
        </div>
      )}

      {/* ferramentas: rede, música, ajuda, voltar às telas */}
      <div className="tiro-tools">
        <span className={`tiro-net ${snap.net}`} role="status">
          {netLabel(snap.net, snap.pingMs)}
        </span>
        <button className={`icon-btn ${board ? 'on' : ''}`} onClick={() => setBoard((b) => !b)} data-tip="Placar (Tab)" aria-label="Placar" aria-pressed={board}>
          <Icon name="chart" size={20} />
        </button>
        {p.onMusicOn && (
          <button className={`icon-btn ${p.musicOn ? 'on' : ''}`} onClick={() => p.onMusicOn?.(!p.musicOn)} data-tip={p.musicOn ? 'Desligar a música' : 'Ligar a música'} aria-label="Música" aria-pressed={!!p.musicOn}>
            <Icon name="music" size={20} />
          </button>
        )}
        {p.musicOn && p.onMusicVolume && <VolumeSlider value={p.musicVolume ?? 0.35} onChange={p.onMusicVolume} label="Volume da música" />}
        <button className={`icon-btn ${help ? 'on' : ''}`} onClick={toggleHelp} data-tip="Como jogar" aria-label="Como jogar" aria-expanded={help}>
          <Icon name="help" size={20} />
        </button>
        {p.onBackToScreens && (
          <button className="icon-btn" onClick={p.onBackToScreens} data-tip="Voltar às telas" aria-label="Voltar às telas">
            <Icon name="grid" size={20} />
          </button>
        )}
      </div>

      {help && (
        <div className="tiro-help" role="dialog" aria-label="Como jogar">
          <div className="hands-head">
            <strong>Como jogar</strong>
            <button className="icon-btn sm" onClick={() => setHelp(false)} aria-label="Fechar ajuda">
              <Icon name="x" size={16} />
            </button>
          </div>
          {HELP.map((h) => (
            <section key={h.title}>
              <h3>{h.title}</h3>
              <ul>
                {h.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </section>
          ))}
          <p className="small muted">M liga e desliga o seu microfone, como no resto da sala.</p>
        </div>
      )}

      {board && !over && <Scoreboard snap={snap} you={you} colors={colors} title="Placar" />}

      {/* fim da partida */}
      {over && (
        <div className="modal-backdrop">
          <div className="modal ranking tiro-ranking pixel-font" role="dialog" aria-modal="true" aria-label="Fim da partida">
            <h2>{youWon ? 'Você ganhou!' : 'Fim da partida'}</h2>
            <ol className="tiro-podium" aria-label="Pódio">
              {[1, 0, 2].map((i) => {
                const r = top[i]
                if (!r) return <li key={i} className="empty" aria-hidden="true" />
                return (
                  <li key={r.id} className={`place-${i + 1} ${r.id === you ? 'me' : ''}`}>
                    <i className="golf-dot" style={{ background: colors[r.id] ?? SPAL.d }} aria-hidden="true" />
                    <span className="n">{names[r.id] ?? 'Jogador'}</span>
                    <span className="k">{r.kills} abates</span>
                    <span className="step">{i + 1}º</span>
                  </li>
                )
              })}
            </ol>
            {rest.length > 0 && (
              <ol className="rank-list" start={4}>
                {rest.map((r, i) => (
                  <li key={r.id} className={r.id === you ? 'me' : ''}>
                    <span className="rank-place">{i + 4}º</span>
                    <span className="rank-name">{names[r.id] ?? 'Jogador'}</span>
                    <span className="rank-net">
                      {r.kills} abates, {r.deaths} mortes
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <div className="modal-actions">
              {p.onBackToScreens && <button onClick={p.onBackToScreens}>Voltar às telas</button>}
              {p.canManage && (
                <button className="danger" onClick={p.onClose}>
                  Fechar
                </button>
              )}
              {p.canManage && (
                <button className="primary" onClick={p.onPlayAgain}>
                  Jogar de novo
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
