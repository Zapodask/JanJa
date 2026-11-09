import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioLevel } from '../audio'
import type { CheckersEvent } from '../../shared/games/checkers/types'
import type { ChessEvent } from '../../shared/games/chess/types'
import type { GolfEvent } from '../../shared/games/golf/types'
import type { PokerEvent } from '../../shared/games/poker/types'
import type { MysteryEvent } from '../../shared/games/mystery/types'
import type { NavalEvent } from '../../shared/games/naval/types'
import type { PoolEvent } from '../../shared/games/pool/types'
import type { StopEvent } from '../../shared/games/stop/types'
import type { TrucoEvent } from '../../shared/games/truco/types'
import type { TycoonEvent } from '../../shared/games/tycoon/types'
import type { GameId } from '../../shared/games/protocol'
import { SHOOTER_SFX, type GameAudio, type MusicTrack, type RawEventBatch, type SfxName } from './contract'
import { sfxGate, type SfxBus } from './shooter/sfxBus'
import {
  checkersSfxForEvent,
  checkersTrackForEvent,
  chessSfxForEvent,
  chessTrackForEvent,
  duckFromLevel,
  wantsGameMusic,
  mysterySfxForEvent,
  mysteryTrackForEvent,
  navalSfxForEvent,
  poolSfxForEvent,
  poolTrackForEvent,
  stopSfxForEvent,
  stopTrackForEvent,
  navalTrackForEvent,
  golfSfxForEvent,
  golfTrackForEvent,
  sfxForEvent,
  trackForEvent,
  trucoSfxForEvent,
  trucoTrackForEvent,
  tycoonSfxForEvent,
  tycoonTrackForEvent,
  type SfxCue
} from './helpers'
import { loadAudio } from './loaders'

export interface MicProbe {
  id: string
  stream?: MediaStream
  /** mic mudo não conta para o ducking */
  muted: boolean
}

function cueFor(gameId: GameId, ev: unknown): SfxCue | null {
  if (gameId === 'golf') return golfSfxForEvent(ev as GolfEvent)
  if (gameId === 'chess') return chessSfxForEvent(ev as ChessEvent)
  if (gameId === 'checkers') return checkersSfxForEvent(ev as CheckersEvent)
  if (gameId === 'tycoon') return tycoonSfxForEvent(ev as TycoonEvent)
  if (gameId === 'truco') return trucoSfxForEvent(ev as TrucoEvent)
  if (gameId === 'naval') return navalSfxForEvent(ev as NavalEvent)
  if (gameId === 'mystery') return mysterySfxForEvent(ev as MysteryEvent)
  if (gameId === 'pool') return poolSfxForEvent(ev as PoolEvent)
  if (gameId === 'stop') return stopSfxForEvent(ev as StopEvent)
  return sfxForEvent(ev as PokerEvent)
}

function trackFor(gameId: GameId, ev: unknown): MusicTrack | null {
  if (gameId === 'golf') return golfTrackForEvent(ev as GolfEvent)
  if (gameId === 'chess') return chessTrackForEvent(ev as ChessEvent)
  if (gameId === 'checkers') return checkersTrackForEvent(ev as CheckersEvent)
  if (gameId === 'tycoon') return tycoonTrackForEvent(ev as TycoonEvent)
  if (gameId === 'truco') return trucoTrackForEvent(ev as TrucoEvent)
  if (gameId === 'naval') return navalTrackForEvent(ev as NavalEvent)
  if (gameId === 'mystery') return mysteryTrackForEvent(ev as MysteryEvent)
  if (gameId === 'pool') return poolTrackForEvent(ev as PoolEvent)
  if (gameId === 'stop') return stopTrackForEvent(ev as StopEvent)
  return trackForEvent(ev as PokerEvent)
}

interface Props {
  gameId: GameId
  seated: boolean
  /** a mesa está aberta na tela (quem assiste também ouve a música) */
  watching: boolean
  started: boolean
  lastEvents: RawEventBatch | null
  /** sons pedidos pela cena (golfe: água, tabela, buraco); `n` sobe a cada um */
  sceneSfx?: { name: SfxName; n: number } | null
  /** sons de aviso da sala (o sino) */
  soundsOn: boolean
  musicOn: boolean
  musicVolume: number
  /** sobe a cada convite novo: toca o embaralhar */
  inviteSeq: number
  /** efeitos do Tiro na Sala (nome, volume e pan pela distância), vindos da cena */
  sfxBus?: SfxBus | null
  /** música pedida pelo jogo (Tiro na Sala: tiroteio, final e a fanfarra); sem isso toca a calma */
  track?: MusicTrack | null
  mics: MicProbe[]
}

function Probe({ id, stream, muted, onLevel }: MicProbe & { onLevel: (id: string, level: number) => void }) {
  const level = useAudioLevel(stream, !muted && !!stream)
  useEffect(() => {
    onLevel(id, level)
    return () => onLevel(id, 0)
  }, [id, level, onLevel])
  return null
}

/**
 * Cuida do áudio da mesa: cria o GameAudio (lazy) depois do primeiro gesto, liga a música para quem está
 * sentado, toca os sfx dos eventos e abaixa a música quando alguém fala. Não desenha nada.
 */
export function GameAudioDriver({ gameId, seated, watching, started, lastEvents, sceneSfx, soundsOn, musicOn, musicVolume, inviteSeq, sfxBus, track, mics }: Props) {
  const audio = useRef<GameAudio | null>(null)
  const [ready, setReady] = useState(false)
  const [gesture, setGesture] = useState(false)
  const levels = useRef(new Map<string, number>())

  // navegadores só liberam áudio depois de um gesto da pessoa (Sentar, Começar, qualquer clique)
  useEffect(() => {
    const on = () => setGesture(true)
    window.addEventListener('pointerdown', on, { once: true })
    window.addEventListener('keydown', on, { once: true })
    return () => {
      window.removeEventListener('pointerdown', on)
      window.removeEventListener('keydown', on)
    }
  }, [])

  useEffect(() => {
    if (!gesture) return
    let dead = false
    void loadAudio().then((create) => {
      if (dead) return
      audio.current = create()
      setReady(true)
    })
    return () => {
      dead = true
      audio.current?.dispose()
      audio.current = null
      setReady(false)
    }
  }, [gesture])

  // música para quem joga ou assiste com a mesa aberta, numa partida em andamento
  const wantMusic = wantsGameMusic({ seated, watching, started, musicOn })
  useEffect(() => {
    const a = audio.current
    if (!ready || !a) return
    if (wantMusic) a.startMusic(trackRef.current ?? 'calma')
    else a.stopMusic()
    return () => a.stopMusic()
  }, [ready, wantMusic])
  // o jogo pode pedir outra faixa (Tiro na Sala: último minuto e fanfarra do pódio)
  const trackRef = useRef<MusicTrack | null>(track ?? null)
  trackRef.current = track ?? null
  useEffect(() => {
    if (ready && wantMusic && track) audio.current?.setTrack(track)
  }, [ready, wantMusic, track])
  useEffect(() => {
    if (ready) audio.current?.setMusicVolume(musicVolume)
  }, [ready, musicVolume])

  // eventos novos viram sfx e troca de faixa (o lote que já existia ao montar não toca de novo)
  const handled = useRef<RawEventBatch | null>(lastEvents)
  useEffect(() => {
    if (!lastEvents || lastEvents === handled.current) return
    handled.current = lastEvents
    const a = audio.current
    if (!ready || !a) return
    for (const ev of lastEvents.events) {
      const cue = cueFor(gameId, ev)
      if (cue && soundsOn) a.sfx(cue.name, cue.count ? { count: cue.count } : undefined)
      const track = trackFor(gameId, ev)
      if (track && wantMusic) a.setTrack(track)
    }
  }, [lastEvents, ready, soundsOn, wantMusic, gameId])

  // sons da cena (simulação local do golfe)
  const lastScene = useRef(sceneSfx?.n ?? 0)
  useEffect(() => {
    if (!sceneSfx || sceneSfx.n === lastScene.current) return
    lastScene.current = sceneSfx.n
    if (ready && soundsOn) audio.current?.sfx(sceneSfx.name)
  }, [sceneSfx, ready, soundsOn])

  // efeitos do tiro: a cena manda nome, volume e pan; passos e rajadas passam por um limitador
  const soundsRef = useRef(soundsOn)
  soundsRef.current = soundsOn
  useEffect(() => {
    if (!ready || !sfxBus) return
    const last = new Map<string, number>()
    return sfxBus.subscribe((name, opts) => {
      if (!soundsRef.current || !(SHOOTER_SFX as readonly string[]).includes(name)) return
      if (!sfxGate(last, name, performance.now())) return
      audio.current?.sfx(name as SfxName, opts)
    })
  }, [ready, sfxBus])

  // convite novo: embaralhar
  const lastInvite = useRef(inviteSeq)
  useEffect(() => {
    if (inviteSeq === lastInvite.current) return
    lastInvite.current = inviteSeq
    if (ready && soundsOn) audio.current?.sfx('shuffle')
  }, [inviteSeq, ready, soundsOn])

  // ducking: a música abaixa enquanto alguém fala na sala
  const onLevel = useCallback((id: string, level: number) => {
    if (level <= 0) levels.current.delete(id)
    else levels.current.set(id, level)
  }, [])
  useEffect(() => {
    if (!ready) return
    let last = -1
    const t = window.setInterval(() => {
      const max = Math.max(0, ...levels.current.values())
      const duck = Math.round(duckFromLevel(max) * 20) / 20
      if (duck !== last) {
        last = duck
        audio.current?.setDuck(duck)
      }
    }, 100)
    return () => window.clearInterval(t)
  }, [ready])

  return (
    <>
      {mics.map((m) => (
        <Probe key={m.id} {...m} onLevel={onLevel} />
      ))}
    </>
  )
}
