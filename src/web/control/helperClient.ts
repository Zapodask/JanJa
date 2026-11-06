import { HELPER_URL, parseHelper, type InputMsg, type Monitor, type PageToHelper } from '../../shared/control'

export type HelperStatus = 'desligado' | 'procurando' | 'precisa-parear' | 'pronto' | 'erro'

export interface HelperSnapshot {
  status: HelperStatus
  monitors: Monitor[]
  /** mensagem para a pessoa (helper ausente, erro do helper) */
  error?: string
  /** código de pareamento recusado */
  pairError?: string
}

export interface HelperDeps {
  url?: string
  makeSocket?: (url: string) => WebSocket
  getToken?: () => string | undefined
  setToken?: (token: string | undefined) => void
  /** esperas entre tentativas, em ms; a última se repete */
  backoffMs?: number[]
}

const DEFAULT_BACKOFF = [1000, 2000, 4000, 8000, 15000]
/** após `paired` o helper deveria mandar `ready`; se não mandar, repetimos o hello com o token novo */
const PAIRED_READY_WAIT_MS = 400

/**
 * Conexão com o helper local (contrato B). Só conecta quando alguém chama start() e,
 * enquanto a pessoa quiser ser controlável, reconecta com backoff.
 */
export class HelperClient {
  private snap: HelperSnapshot = { status: 'desligado', monitors: [] }
  private ws?: WebSocket
  private wanted = false
  private opened = false
  private attempt = 0
  private retryTimer?: ReturnType<typeof setTimeout>
  private pairedTimer?: ReturnType<typeof setTimeout>
  private readonly listeners = new Set<() => void>()
  private readonly panicListeners = new Set<() => void>()
  private readonly url: string
  private readonly backoff: number[]

  constructor(private readonly deps: HelperDeps = {}) {
    this.url = deps.url ?? HELPER_URL
    this.backoff = deps.backoffMs?.length ? deps.backoffMs : DEFAULT_BACKOFF
  }

  get snapshot(): HelperSnapshot {
    return this.snap
  }

  get ready(): boolean {
    return this.snap.status === 'pronto'
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onPanic(cb: () => void): () => void {
    this.panicListeners.add(cb)
    return () => this.panicListeners.delete(cb)
  }

  /** Quer ser controlável: conecta (e reconecta) até chamarem stop(). */
  start(): void {
    if (this.wanted) return
    this.wanted = true
    this.attempt = 0
    this.set({ status: 'procurando', monitors: [], error: undefined, pairError: undefined })
    this.connect()
  }

  stop(): void {
    this.wanted = false
    this.clearTimers()
    this.detach()
    this.set({ status: 'desligado', monitors: [], error: undefined, pairError: undefined })
  }

  pair(code: string): boolean {
    if (this.snap.status !== 'precisa-parear' || !/^\d{6}$/.test(code)) return false
    this.set({ ...this.snap, pairError: undefined })
    return this.send({ type: 'pair', code })
  }

  setSession(active: boolean, monitor?: number, peerName?: string): void {
    if (!this.ready && active) return
    this.send({ type: 'session', active, ...(monitor !== undefined ? { monitor } : {}), ...(peerName ? { peerName } : {}) })
  }

  sendInput(ev: InputMsg): void {
    if (this.ready) this.send({ type: 'input', ev })
  }

  // ---------------- internos ----------------

  private set(next: HelperSnapshot): void {
    this.snap = next
    for (const cb of this.listeners) cb()
  }

  private send(msg: PageToHelper): boolean {
    if (this.ws?.readyState !== 1 /* OPEN */) return false
    this.ws.send(JSON.stringify(msg))
    return true
  }

  private clearTimers(): void {
    clearTimeout(this.retryTimer)
    clearTimeout(this.pairedTimer)
    this.retryTimer = this.pairedTimer = undefined
  }

  private detach(): void {
    const ws = this.ws
    this.ws = undefined
    if (!ws) return
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
    try {
      ws.close()
    } catch {
      /* já fechado */
    }
  }

  private connect(): void {
    if (!this.wanted) return
    this.opened = false
    let ws: WebSocket
    try {
      ws = (this.deps.makeSocket ?? ((u) => new WebSocket(u)))(this.url)
    } catch {
      this.lost()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      if (this.ws !== ws) return
      this.opened = true
      this.attempt = 0
      this.sendHello()
    }
    ws.onmessage = (ev) => {
      if (this.ws === ws) this.handle(ev.data)
    }
    ws.onerror = () => undefined // o onclose logo em seguida cuida
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = undefined
      this.lost()
    }
  }

  private sendHello(): void {
    const token = this.deps.getToken?.()
    this.send({ type: 'hello', ...(token ? { token } : {}), version: 1 })
  }

  private handle(data: unknown): void {
    const msg = parseHelper(data)
    if (!msg) return
    switch (msg.type) {
      case 'need-pair':
        // se tínhamos token e ele foi recusado, não vale mais
        if (this.deps.getToken?.()) this.deps.setToken?.(undefined)
        this.set({ status: 'precisa-parear', monitors: [], error: undefined, pairError: this.snap.status === 'precisa-parear' ? this.snap.pairError : undefined })
        break
      case 'paired':
        this.deps.setToken?.(msg.token)
        clearTimeout(this.pairedTimer)
        this.pairedTimer = setTimeout(() => {
          if (this.snap.status !== 'pronto') this.sendHello()
        }, PAIRED_READY_WAIT_MS)
        break
      case 'ready':
        clearTimeout(this.pairedTimer)
        this.set({ status: 'pronto', monitors: msg.monitors, error: undefined, pairError: undefined })
        break
      case 'panic':
        for (const cb of this.panicListeners) cb()
        break
      case 'error':
        if (this.snap.status === 'precisa-parear') this.set({ ...this.snap, pairError: msg.message })
        else if (this.snap.status === 'pronto') this.set({ ...this.snap, error: msg.message })
        else this.set({ status: 'erro', monitors: [], error: msg.message })
        break
    }
  }

  /** Conexão caiu ou nunca abriu. */
  private lost(): void {
    if (!this.wanted) return
    const wasOpen = this.opened
    this.opened = false
    this.clearTimers()
    this.set({
      status: wasOpen ? 'procurando' : 'erro',
      monitors: [],
      error: wasOpen ? undefined : 'Não achei o JanJa Helper neste PC. Abra o helper e tente de novo.'
    })
    const wait = this.backoff[Math.min(this.attempt, this.backoff.length - 1)]
    this.attempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      this.connect()
    }, wait)
  }
}
