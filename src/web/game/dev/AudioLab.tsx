/**
 * Laboratório de áudio do poker (só em dev). Rota: /dev/audio (registrada em ./routes.ts).
 * Carregue sempre com import dinâmico dentro de `import.meta.env.DEV`:
 *   const AudioLab = lazy(() => import('./game/dev/AudioLab'))
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameAudio, MusicTrack, SfxName } from '../contract'
import { createGameAudio, DEFAULT_MUSIC_VOLUME } from '../audio'
import { TRACKS, scoreText, trackSeconds } from '../audio/songs'

const SFX: SfxName[] = ['shuffle', 'deal', 'flip', 'chip', 'check', 'fold', 'turn', 'allin', 'win', 'rebuy', 'podium']
const TRACK_LIST: MusicTrack[] = ['calma', 'cisnes', 'tensao', 'vitoria']

const box = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '8px 0' } as const

export default function AudioLab() {
  const audio = useRef<GameAudio | undefined>(undefined)
  const [playing, setPlaying] = useState(false)
  const [track, setTrack] = useState<MusicTrack>('calma')
  const [volume, setVolume] = useState(DEFAULT_MUSIC_VOLUME)
  const [duck, setDuck] = useState(0)
  const [chips, setChips] = useState(3)
  const [showScore, setShowScore] = useState<MusicTrack | null>(null)
  const [log, setLog] = useState<string[]>([])

  const get = (): GameAudio => (audio.current ??= createGameAudio())
  useEffect(() => () => audio.current?.dispose(), [])
  const note = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${s}`, ...l].slice(0, 8))

  const score = useMemo(() => (showScore ? scoreText(TRACKS[showScore]) : ''), [showScore])

  return (
    <main style={{ padding: 16, maxWidth: 760, margin: '0 auto', color: '#f3e9dc', background: '#221c19', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20 }}>Laboratório de áudio do poker</h1>
      <p style={{ opacity: 0.7 }}>Só em dev. Música chiptune original e efeitos, gerados em Web Audio. Clique em qualquer botão para liberar o som.</p>

      <h2 style={{ fontSize: 16 }}>Música</h2>
      <div style={box}>
        {TRACK_LIST.map((t) => (
          <button
            key={t}
            onClick={() => {
              setTrack(t)
              if (playing) {
                get().setTrack(t)
                note(`troca para ${t} no próximo compasso`)
              } else {
                get().startMusic(t)
                setPlaying(true)
                note(`inicia ${t}`)
              }
            }}
            aria-pressed={playing && track === t}
          >
            {t} ({TRACKS[t].bpm} BPM, {Math.round(trackSeconds(TRACKS[t]))} s{TRACKS[t].once ? ', uma vez' : ''})
          </button>
        ))}
        <button
          onClick={() => {
            get().stopMusic()
            setPlaying(false)
            note('para')
          }}
          disabled={!playing}
        >
          Parar
        </button>
      </div>
      <div style={box}>
        <label>
          Volume {Math.round(volume * 100)}%{' '}
          <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => { const v = Number(e.target.value); setVolume(v); get().setMusicVolume(v) }} />
        </label>
        <label>
          Ducking {Math.round(duck * 100)}%{' '}
          <input type="range" min={0} max={1} step={0.01} value={duck} onChange={(e) => { const v = Number(e.target.value); setDuck(v); get().setDuck(v) }} />
        </label>
      </div>

      <h2 style={{ fontSize: 16 }}>Efeitos</h2>
      <div style={box}>
        {SFX.map((n) => (
          <button key={n} onClick={() => { get().sfx(n, n === 'chip' ? { count: chips } : undefined); note(`sfx ${n}`) }}>
            {n}
          </button>
        ))}
        <label>
          fichas {chips}{' '}
          <input type="range" min={1} max={8} step={1} value={chips} onChange={(e) => setChips(Number(e.target.value))} />
        </label>
      </div>

      <h2 style={{ fontSize: 16 }}>Partitura</h2>
      <div style={box}>
        {TRACK_LIST.map((t) => (
          <button key={t} onClick={() => setShowScore(showScore === t ? null : t)} aria-pressed={showScore === t}>
            {t}
          </button>
        ))}
      </div>
      {score && <pre style={{ fontSize: 12, overflow: 'auto', maxHeight: 320, background: '#2d2521', padding: 8 }}>{score}</pre>}

      <h2 style={{ fontSize: 16 }}>Registro</h2>
      <ul style={{ fontSize: 12, opacity: 0.8 }}>{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </main>
  )
}
