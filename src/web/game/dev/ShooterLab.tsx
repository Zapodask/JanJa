import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { KillLimit, MapId, MatchMinutes, SimState } from '../../../shared/games/shooter/types'
import { toneOf } from '../../ui/Avatar'
import { ShooterHud } from '../../ui/ShooterHud'
import type { InputState, ShooterSession } from '../shooter/contract'
import { createLocalSession } from '../shooter/net/local'
import { ShooterScene } from '../shooter/scene/ShooterScene'

type Local = ShooterSession & { sim(): SimState }

const BOT_COLORS = ['#7E9CB5', '#C27C8E', '#8FAE6B', '#D4A373']
const SIZES: Record<string, [number, number]> = { 'livre': [0, 0], '960x540': [960, 540], '1920x1080': [1920, 1080], '390x844 celular': [390, 844], '480x270': [480, 270], '2560x1440': [2560, 1440] }

interface TiroLab {
  frame: () => ReturnType<ShooterSession['frame']>
  sim: () => SimState
  teleport: (x: number, y: number, slot?: number) => void
  /** trava a entrada do seu boneco (null solta) */
  hold: (i: Partial<InputState> | null) => void
  /** liga um piloto automático simples para o seu boneco (caminha e atira no mais perto) */
  auto: (on?: boolean) => void
  give: (weapon: 'pistola' | 'escopeta' | 'sub' | 'rifle' | 'rolha', slot?: number) => void
  hp: (n: number, slot?: number) => void
  restart: () => void
  /** o mapa inteiro desenhado (data URL), para conferir a arte dos tiles */
  mapImage: (id: MapId) => Promise<string>
}

/**
 * Laboratório do Tiro na Sala (só em dev): a simulação de verdade rodando aqui mesmo, sem rede.
 * `?map=quintal&bots=3&minutes=3&size=960x540&reduced=1&hud=0` e `window.__tiro` (frame, sim, teleport, hold, auto, give, hp).
 */
export function ShooterLab(): ReactElement {
  const q = new URLSearchParams(location.search)
  const mapId: MapId = q.get('map') === 'quintal' ? 'quintal' : 'casa'
  const bots = Math.max(0, Math.min(4, Number(q.get('bots') ?? 3)))
  const minutes = ([3, 5, 8].includes(Number(q.get('minutes'))) ? Number(q.get('minutes')) : 5) as MatchMinutes
  const killLimit = ([10, 20, 30].includes(Number(q.get('kills'))) ? Number(q.get('kills')) : 20) as KillLimit
  const [run, setRun] = useState(0)
  const [size, setSize] = useState(q.get('size') ?? 'livre')
  const [reduced, setReduced] = useState(q.get('reduced') === '1')
  const showHud = q.get('hud') !== '0'

  const base = useMemo<Local>(() => createLocalSession({ mapId, bots, minutes, killLimit, seed: q.has('seed') ? Number(q.get('seed')) : undefined }), [run]) // eslint-disable-line react-hooks/exhaustive-deps
  const override = useMemo<{ cur: Partial<InputState> | null; auto: boolean }>(() => ({ cur: null, auto: false }), [])
  const session = useMemo<Local>(
    () => ({
      ...base,
      frame: () => base.frame(),
      setInput: (i) => {
        if (override.auto) {
          const f = base.frame()
          const me = f?.players.find((p) => p.slot === f.me)
          if (f && me) {
            const foe = f.players.filter((p) => p.slot !== me.slot && p.alive).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0]
            if (foe) {
              const dx = foe.x - me.x
              const dy = foe.y - me.y
              const l = Math.hypot(dx, dy) || 1
              const t = f.timeLeftMs / 1000
              base.setInput({ mx: Math.cos(t * 0.8), my: Math.sin(t * 0.6), ax: dx / l, ay: dy / l, buttons: 1 | (Math.floor(t) % 4 === 0 ? 2 : 0) | (Math.floor(t * 0.5) % 5 === 0 ? 4 : 0) })
              return
            }
          }
        }
        base.setInput(override.cur ? { ...i, ...override.cur } : i)
      },
      onEvents: (cb) => base.onEvents(cb),
      dispose: () => base.dispose(),
      sim: () => base.sim()
    }),
    [base, override]
  )
  useEffect(() => () => base.dispose(), [base])

  const colors = useMemo(() => {
    const c: Record<string, string> = { voce: toneOf('Você') }
    for (let i = 0; i < 4; i++) c[`bot-${i + 1}`] = BOT_COLORS[i]!
    return c
  }, [])

  useEffect(() => {
    const player = (slot: number) => base.sim().players.find((p) => p.slot === slot)
    const lab: TiroLab = {
      frame: () => base.frame(),
      sim: () => base.sim(),
      teleport: (x, y, slot = 0) => {
        const p = player(slot)
        if (p) {
          p.x = x
          p.y = y
        }
      },
      hold: (i) => {
        override.cur = i
      },
      auto: (on = true) => {
        override.auto = on
      },
      give: (weapon, slot = 0) => {
        const p = player(slot)
        if (p) {
          p.weapon = weapon
          p.ammo = weapon === 'pistola' ? Infinity : 99
        }
      },
      hp: (n, slot = 0) => {
        const p = player(slot)
        if (p) p.hp = n
      },
      restart: () => setRun((r) => r + 1),
      mapImage: async (id) => {
        const [{ buildMapCanvas }, { getMap }] = await Promise.all([import('../shooter/scene/mapart'), import('../../../shared/games/shooter/maps')])
        return buildMapCanvas(getMap(id)).canvas.toDataURL()
      }
    }
    ;(window as unknown as { __tiro: TiroLab }).__tiro = lab
  }, [base, override])

  const [w, h] = SIZES[size] ?? [0, 0]
  const sty = w ? { width: w, height: h } : { width: '100vw', height: '100vh' }
  return (
    <div style={{ background: '#0b0807', minHeight: '100vh' }}>
      <div style={{ position: 'relative', overflow: 'hidden', background: '#221C19', ...sty }} data-lab-stage>
        <ShooterScene session={session} colors={colors} reducedMotion={reduced} onSfx={undefined} />
        {showHud && <ShooterHud session={session} you="voce" colors={colors} canManage onPlayAgain={() => setRun((r) => r + 1)} onClose={() => undefined} names={undefined} />}
      </div>
      {q.get('ui') === '1' && (
        <div style={{ font: '12px system-ui', color: '#ddd', padding: 6, display: 'flex', gap: 8 }}>
          <select value={size} onChange={(e) => setSize(e.target.value)}>
            {Object.keys(SIZES).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <label>
            <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> reduzir movimento
          </label>
          <button onClick={() => setRun((r) => r + 1)}>Recomeçar</button>
        </div>
      )}
    </div>
  )
}
