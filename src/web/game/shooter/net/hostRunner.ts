/**
 * Quem roda o HostLoop: um Web Worker de módulo ou, se não der para criar, a thread principal.
 */
import { HostLoop, type HostIn, type HostOut } from './hostCore'
import { simApi } from './simBinding'

export type HostInit = Extract<HostIn, { k: 'init' }>

export interface HostRunner {
  kind: 'worker' | 'main'
  handle(m: Exclude<HostIn, { k: 'init' }>): void
  dispose(): void
}

/** Mesmo laço na thread principal (fallback e laboratório). */
export function createMainRunner(init: HostInit, out: (m: HostOut) => void, now: () => number = () => performance.now()): HostRunner {
  const loop = new HostLoop(simApi, init, out, now())
  const timer = setInterval(() => loop.advance(now()), 8)
  return {
    kind: 'main',
    handle: (m) => loop.handle(m),
    dispose() {
      clearInterval(timer)
      loop.handle({ k: 'stop' })
    }
  }
}

export function createHostRunner(init: HostInit, out: (m: HostOut) => void): HostRunner {
  if (typeof Worker === 'undefined') return createMainRunner(init, out)
  let worker: Worker
  try {
    worker = new Worker(new URL('./hostWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    return createMainRunner(init, out)
  }
  let got = false
  let fallback: HostRunner | undefined
  let disposed = false
  const queue: Exclude<HostIn, { k: 'init' }>[] = []
  worker.onmessage = (e: MessageEvent<HostOut>) => {
    got = true
    out(e.data)
  }
  // Worker que não carrega (CSP, módulo quebrado): cai para a thread principal com o mesmo início
  worker.onerror = () => {
    if (got || fallback || disposed) return
    worker.terminate()
    fallback = createMainRunner(init, out)
    for (const m of queue) fallback.handle(m)
    queue.length = 0
  }
  worker.postMessage(init)
  return {
    kind: 'worker',
    handle(m) {
      if (fallback) fallback.handle(m)
      else {
        // só guarda o necessário para o caso de cair no fallback logo no início
        if (!got) {
          queue.push(m)
          if (queue.length > 64) queue.shift()
        }
        worker.postMessage(m)
      }
    },
    dispose() {
      disposed = true
      fallback?.dispose()
      try {
        worker.postMessage({ k: 'stop' } satisfies HostIn)
      } catch {
        /* já morreu */
      }
      worker.terminate()
    }
  }
}
