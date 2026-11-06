import { getContext } from './audio'

/**
 * Sons curtos gerados na hora (Web Audio): sem arquivos, nada a baixar, CSP intacto.
 * Volume baixo de propósito: avisam sem assustar.
 */

/** Toca para a mesma saída de áudio escolhida na sala, quando o navegador deixa. */
export function setSoundSink(sinkId: string): void {
  const ctx = getContext() as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | undefined
  if (!ctx?.setSinkId) return
  ctx.setSinkId(sinkId === 'default' ? '' : sinkId).catch(() => undefined)
}

function ready(): AudioContext | undefined {
  const ctx = getContext()
  if (!ctx) return undefined
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Uma nota com ataque rápido e queda suave. */
function note(ctx: AudioContext, freq: number, at: number, dur: number, type: OscillatorType, peak: number): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(gain).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + dur + 0.02)
}

/** Campainha "ding-dong": alguém está na porta pedindo para entrar. */
export function playDoorbell(): void {
  const ctx = ready()
  if (!ctx) return
  const t = ctx.currentTime + 0.02
  note(ctx, 659.25, t, 0.55, 'triangle', 0.22) // mi
  note(ctx, 1318.5, t, 0.25, 'sine', 0.04) // brilho
  note(ctx, 523.25, t + 0.32, 0.8, 'triangle', 0.22) // dó
  note(ctx, 1046.5, t + 0.32, 0.3, 'sine', 0.04)
}

/** "Bloop" subindo, como uma TV ligando: alguém começou a compartilhar a tela. */
export function playShareOn(): void {
  const ctx = ready()
  if (!ctx) return
  const t = ctx.currentTime + 0.02
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(260, t)
  osc.frequency.exponentialRampToValueAtTime(880, t + 0.16)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + 0.3)
  note(ctx, 1174.7, t + 0.17, 0.22, 'triangle', 0.08) // ré agudo fechando
}

/** Uma batida curta e grave (madeira), com um clique de ataque. */
function knock(ctx: AudioContext, at: number): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(220, at)
  osc.frequency.exponentialRampToValueAtTime(110, at + 0.09)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(0.35, at + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12)
  osc.connect(gain).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + 0.14)
  note(ctx, 1800, at, 0.025, 'square', 0.03)
}

/** "Toc-toc": alguém quer controlar o seu PC. Diferente da campainha de entrada. */
export function playKnock(): void {
  const ctx = ready()
  if (!ctx) return
  const t = ctx.currentTime + 0.02
  knock(ctx, t)
  knock(ctx, t + 0.16)
}
