import { LOG_SIZE, type DiagEvent, type DiagKind } from './diag'

/** Cor de cada tipo de evento (selo do console e faixa do diário). */
export const DIAG_COLORS: Record<DiagKind, string> = {
  up: '#6FD49B',
  down: '#FF7A6B',
  perda: '#FF7A6B',
  travada: '#FFC94A',
  cpu: '#FFC94A',
  banda: '#FFC94A',
  relay: '#F3EBDD',
  direto: '#F3EBDD',
  tela: '#B7A99A',
  info: '#B7A99A'
}

const KIND_LABEL: Record<DiagKind, string> = {
  up: 'subiu',
  down: 'desceu',
  perda: 'perda',
  travada: 'travada',
  cpu: 'cpu',
  banda: 'banda',
  relay: 'relay',
  direto: 'direto',
  tela: 'tela',
  info: 'info'
}

const two = (n: number): string => String(n).padStart(2, '0')

/** hh:mm:ss no fuso local. */
export function clockOf(at: number): string {
  const d = new Date(at)
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

const BADGE = 'padding:1px 6px;border-radius:3px;font-weight:700;'

/** Argumentos para `console.info(...)`: selo JanJa, selo do tipo, hora e texto. */
export function consoleLine(e: DiagEvent): [string, ...string[]] {
  return [
    '%cJanJa%c %c' + KIND_LABEL[e.kind] + '%c %s %s',
    BADGE + 'background:#221C19;color:#FFC94A;border:1px solid #FFC94A;',
    '',
    BADGE + `background:${DIAG_COLORS[e.kind]};color:#221C19;`,
    '',
    clockOf(e.at),
    e.text
  ]
}

export interface DiagLogOptions {
  size?: number
  /** escreve cada evento no console.info (padrão: sim) */
  echo?: boolean
  clock?: () => number
}

/** Diário de eventos da conexão: anel de tamanho fixo, mais antigo primeiro. */
export class DiagLog {
  private events: DiagEvent[] = []
  private nextId = 1
  private readonly listeners = new Set<() => void>()
  private readonly size: number
  private readonly echo: boolean
  private readonly clock: () => number

  constructor(opts: DiagLogOptions = {}) {
    this.size = opts.size ?? LOG_SIZE
    this.echo = opts.echo ?? true
    this.clock = opts.clock ?? (() => Date.now())
  }

  push(e: { kind: DiagKind; text: string; who?: string; at?: number }): void {
    const ev: DiagEvent = { id: this.nextId++, at: e.at ?? this.clock(), kind: e.kind, text: e.text, ...(e.who ? { who: e.who } : {}) }
    this.events.push(ev)
    if (this.events.length > this.size) this.events.splice(0, this.events.length - this.size)
    if (this.echo) console.info(...consoleLine(ev))
    this.notify()
  }

  list(): DiagEvent[] {
    return this.events.slice()
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  clear(): void {
    this.events = []
    this.notify()
  }

  private notify(): void {
    for (const cb of this.listeners) cb()
  }
}
