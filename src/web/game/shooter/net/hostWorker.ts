/**
 * Web Worker de módulo que roda a simulação do host (não pode ser blob: a CSP é script-src 'self').
 * Fala por postMessage com hostRunner.ts: recebe HostIn, devolve HostOut.
 */
import { HostLoop, type HostIn, type HostOut } from './hostCore'
import { simApi } from './simBinding'

const ctx = self as unknown as {
  postMessage(m: HostOut, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<HostIn>) => void) | null
  close(): void
}

let loop: HostLoop | undefined
let timer: ReturnType<typeof setInterval> | undefined

ctx.onmessage = (e) => {
  const m = e.data
  if (m.k === 'init') {
    if (timer !== undefined) clearInterval(timer)
    const l = new HostLoop(simApi, m, (o) => ctx.postMessage(o, o.k === 'snap' ? [o.bytes] : []), performance.now())
    loop = l
    timer = setInterval(() => l.advance(performance.now()), 8)
  } else if (m.k === 'stop') {
    loop?.handle(m)
    if (timer !== undefined) clearInterval(timer)
    ctx.close()
  } else loop?.handle(m)
}
