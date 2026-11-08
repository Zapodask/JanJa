import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioLevel } from '../audio'
import type { GolfEvent } from '../../shared/games/golf/types'
import type { PokerEvent } from '../../shared/games/poker/types'
import type { GameId } from '../../shared/games/protocol'
import type { GameAudio, RawEventBatch, SfxName } from './contract'
import { duckFromLevel, golfSfxForEvent, golfTrackForEvent, sfxForEvent, trackForEvent } from './helpers'
import { loadAudio } from './loaders'

export interface MicProbe {
  id: string
  stream?: MediaStream
  /** mic mudo não conta para o ducking */
  muted: boolean
}

interface Props {
  gameId: GameId
  seated: boolean
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
export function GameAudioDriver({ gameId, seated, started, lastEvents, sceneSfx, soundsOn, musicOn, musicVolume, inviteSeq, mics }: Props) {
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

  // música só para quem está sentado numa partida em andamento
  const wantMusic = seated && started && musicOn
  useEffect(() => {
    const a = audio.current
    if (!ready || !a) return
    if (wantMusic) a.startMusic('calma')
    else a.stopMusic()
    return () => a.stopMusic()
  }, [ready, wantMusic])
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
      const cue = gameId === 'golf' ? golfSfxForEvent(ev as GolfEvent) : sfxForEvent(ev as PokerEvent)
      if (cue && soundsOn) a.sfx(cue.name, cue.count ? { count: cue.count } : undefined)
      const track = gameId === 'golf' ? golfTrackForEvent(ev as GolfEvent) : trackForEvent(ev as PokerEvent)
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
