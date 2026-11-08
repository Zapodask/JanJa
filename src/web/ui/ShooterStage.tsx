import { lazy, Suspense, useEffect, useMemo, useRef, type ReactElement } from 'react'
import { BOT_SLOT_BASE, type ShooterAction, type ShooterView } from '../../shared/games/shooter/types'
import type { MusicTrack } from '../game/contract'
import { loadShooterScene } from '../game/loaders'
import type { ShooterSessionDeps } from '../game/shooter/contract'
import { useShooterSession } from '../game/shooter/net/useShooterSession'
import { BOT_TONES, shooterTrack, type SfxBus } from '../game/shooter/sfxBus'
import { toneOf } from './Avatar'
import { ShooterHud } from './ShooterHud'
import { TvOff } from './Brand'

const ShooterSceneLazy = lazy(loadShooterScene)

export interface ShooterStageProps {
  view: ShooterView
  manager: ShooterSessionDeps['manager']
  relay: ShooterSessionDeps['relay']
  onRelay: ShooterSessionDeps['onRelay']
  act: (action: ShooterAction) => void
  /** a cena e o HUD aparecem (false: "voltar às telas", a simulação segue viva) */
  visible: boolean
  /** uma tela em destaque ocupa o palco: o jogo vira miniatura, sem entrada */
  pip: boolean
  canManage: boolean
  reducedMotion: boolean
  sfxBus: SfxBus
  onTrack: (track: MusicTrack | null) => void
  onPlayAgain: () => void
  onClose: () => void
  onBackToScreens: () => void
  /** G: alterna a tela em destaque */
  onSpotlight: () => void
  musicOn: boolean
  musicVolume: number
  onMusicOn: (on: boolean) => void
  onMusicVolume: (v: number) => void
}

/** cor de cada jogador: o humano pela cor do apelido (como no resto da sala), os robôs com cores próprias */
export function shooterColors(view: ShooterView): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of view.players) out[p.id] = p.bot ? (BOT_TONES[(p.slot - BOT_SLOT_BASE + BOT_TONES.length) % BOT_TONES.length] ?? BOT_TONES[0]!) : toneOf(p.name)
  return out
}

/**
 * O Tiro na Sala dentro da sala: cria a sessão (que roda a simulação quando você é o host, por isso ela
 * continua viva mesmo escondida), carrega a cena Pixi só quando precisa, desenha o HUD e avisa a música.
 */
export function ShooterStage(p: ShooterStageProps): ReactElement | null {
  const { view } = p
  const deps = useMemo<ShooterSessionDeps>(
    () => ({ view, manager: p.manager, relay: p.relay, onRelay: p.onRelay, act: p.act }),
    [view, p.manager, p.relay, p.onRelay, p.act]
  )
  const session = useShooterSession(deps)
  const colors = useMemo(() => shooterColors(view), [view])

  // música: tiroteio, final (último minuto) e fanfarra
  const onTrack = useRef(p.onTrack)
  onTrack.current = p.onTrack
  useEffect(() => {
    if (!session) return
    let last: MusicTrack | null = null
    const read = () => {
      const f = session.frame()
      const t = f ? shooterTrack(f.phase, f.timeLeftMs) : null
      const next = view.phase === 'fim' ? 'vitoria' : t
      if (next !== last) {
        last = next
        onTrack.current(next)
      }
    }
    read()
    const id = window.setInterval(read, 400)
    return () => {
      window.clearInterval(id)
      onTrack.current(null)
    }
  }, [session, view.phase])

  // G: alterna a tela em destaque (como no poker); Esc devolve o palco ao jogo
  const spotlight = useRef(p.onSpotlight)
  spotlight.current = p.onSpotlight
  const pipRef = useRef(p.pip)
  pipRef.current = p.pip
  useEffect(() => {
    if (!p.visible) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() === 'g') {
        e.preventDefault()
        spotlight.current()
      } else if (e.key === 'Escape' && pipRef.current && !document.fullscreenElement) {
        spotlight.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p.visible])

  if (!p.visible) return null
  const you = view.you?.playerId ?? null
  return (
    <div className={`scene-host shooter-host ${p.pip ? 'pip' : ''}`} data-shooter-stage>
      {session ? (
        <Suspense
          fallback={
            <div className="scene-loading">
              <TvOff noise />
            </div>
          }
        >
          <ShooterSceneLazy session={session} colors={colors} reducedMotion={p.reducedMotion} onSfx={p.sfxBus.emit} inputEnabled={!p.pip} />
        </Suspense>
      ) : (
        <div className="scene-loading">
          <TvOff noise />
        </div>
      )}
      {session && (
        <ShooterHud
          session={session}
          view={view}
          you={you}
          colors={colors}
          canManage={p.canManage}
          onPlayAgain={p.onPlayAgain}
          onClose={p.onClose}
          onBackToScreens={p.onBackToScreens}
          musicOn={p.musicOn}
          musicVolume={p.musicVolume}
          onMusicOn={p.onMusicOn}
          onMusicVolume={p.onMusicVolume}
          hidden={p.pip}
        />
      )}
    </div>
  )
}
