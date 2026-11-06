import { useEffect, useRef, useState } from 'react'

/** Um AudioContext só para a página toda, criado quando alguém precisar. */
let ctx: AudioContext | undefined
let unlockBound = false

function getContext(): AudioContext | undefined {
  if (typeof AudioContext === 'undefined') return undefined
  ctx ??= new AudioContext()
  if (!unlockBound) {
    unlockBound = true
    // navegadores só liberam o áudio depois de um gesto da pessoa
    const resume = () => {
      void ctx?.resume()
      if (ctx?.state === 'running') {
        window.removeEventListener('pointerdown', resume)
        window.removeEventListener('keydown', resume)
      }
    }
    window.addEventListener('pointerdown', resume)
    window.addEventListener('keydown', resume)
  }
  return ctx
}

const POLL_MS = 80 // ~12 Hz

/**
 * Observa o volume (RMS, 0..1 já com ganho) de um stream. Refaz a ligação se chegarem
 * trilhas de áudio depois. Retorna a função de limpeza.
 */
function watchLevel(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const audio = getContext()
  if (!audio) return () => undefined

  let source: MediaStreamAudioSourceNode | undefined
  let analyser: AnalyserNode | undefined
  let sink: GainNode | undefined
  let buffer: Float32Array<ArrayBuffer> | undefined
  let smooth = 0

  const disconnect = () => {
    source?.disconnect()
    analyser?.disconnect()
    sink?.disconnect()
    source = analyser = sink = undefined
  }

  const connect = () => {
    disconnect()
    if (stream.getAudioTracks().length === 0) return
    source = audio.createMediaStreamSource(stream)
    analyser = audio.createAnalyser()
    analyser.fftSize = 1024
    buffer = new Float32Array(analyser.fftSize)
    // ganho 0 até o destino: garante que o navegador processe o grafo sem tocar nada em dobro
    sink = audio.createGain()
    sink.gain.value = 0
    source.connect(analyser)
    analyser.connect(sink)
    sink.connect(audio.destination)
  }

  const tick = () => {
    let raw = 0
    if (analyser && buffer && audio.state === 'running') {
      analyser.getFloatTimeDomainData(buffer)
      let sum = 0
      for (const v of buffer) sum += v * v
      raw = Math.min(1, Math.sqrt(sum / buffer.length) * 5)
    }
    // sobe rápido, desce devagar
    smooth = raw > smooth ? smooth * 0.3 + raw * 0.7 : smooth * 0.75 + raw * 0.25
    onLevel(smooth < 0.01 ? 0 : smooth)
  }

  connect()
  stream.addEventListener('addtrack', connect)
  stream.addEventListener('removetrack', connect)
  const timer = window.setInterval(tick, POLL_MS)

  return () => {
    window.clearInterval(timer)
    stream.removeEventListener('addtrack', connect)
    stream.removeEventListener('removetrack', connect)
    disconnect()
  }
}

/** Nível 0..1 suavizado, para animar barras/anel. */
export function useAudioLevel(stream: MediaStream | undefined, enabled = true): number {
  const [level, setLevel] = useState(0)
  useEffect(() => {
    if (!stream || !enabled) {
      setLevel(0)
      return
    }
    let last = 0
    const stop = watchLevel(stream, (l) => {
      // só re-renderiza quando muda de verdade
      if (Math.abs(l - last) > 0.02 || (l === 0 && last !== 0)) {
        last = l
        setLevel(l)
      }
    })
    return () => {
      stop()
      setLevel(0)
    }
  }, [stream, enabled])
  return level
}

const ON_LEVEL = 0.12
const OFF_LEVEL = 0.07
const HOLD_MS = 300

/** true enquanto o volume passa de um limiar (histerese de ~300 ms ao parar). */
export function useSpeaking(stream: MediaStream | undefined, enabled = true): boolean {
  const [speaking, setSpeaking] = useState(false)
  const state = useRef({ speaking: false, quietSince: 0 })

  useEffect(() => {
    const s = state.current
    s.speaking = false
    s.quietSince = 0
    setSpeaking(false)
    if (!stream || !enabled) return
    const set = (v: boolean) => {
      if (s.speaking !== v) {
        s.speaking = v
        setSpeaking(v)
      }
    }
    const stop = watchLevel(stream, (l) => {
      const now = performance.now()
      if (l > ON_LEVEL || (s.speaking && l > OFF_LEVEL)) {
        s.quietSince = 0
        set(true)
      } else if (s.speaking) {
        s.quietSince ||= now
        if (now - s.quietSince >= HOLD_MS) set(false)
      }
    })
    return () => {
      stop()
      s.speaking = false
      setSpeaking(false)
    }
  }, [stream, enabled])

  return speaking
}
