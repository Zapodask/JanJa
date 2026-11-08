/** Lógica pura do painel Sinal (sem React nem DOM): testável em Node. */
import type { PeerView } from '../rtc/PeerManager'
import type { DiagEvent, DiagKind, SendDiag } from '../rtc/diag'
import {
  assess,
  fmtMbps,
  fmtPct,
  fmtRes,
  type Health,
  type InboundStats,
  type Limitation,
  type OutboundStats,
  type Route,
  type SendSummary,
  type Verdict
} from '../rtc/stats'

const two = (n: number) => String(n).padStart(2, '0')

/** Hora local do evento, hh:mm:ss. */
export function fmtClock(at: number): string {
  const d = new Date(at)
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

const RANK: Record<Health, number> = { bom: 0, atencao: 1, ruim: 2 }

/** A pior saúde da lista; sem nenhuma leitura = 'idle' (ninguém compartilhando). */
export function overallHealth(list: (Health | undefined)[]): Health | 'idle' {
  let worst: Health | undefined
  for (const h of list) if (h && (!worst || RANK[h] > RANK[worst])) worst = h
  return worst ?? 'idle'
}

/** Saúde do que eu envio: a pior entre os espectadores. Sem espectadores, sem veredito. */
export function sendHealth(send?: SendDiag): Health | undefined {
  if (!send || !send.viewers.length) return undefined
  const each = send.viewers.map((v): Health => {
    const o = v.out
    if (!o) return 'bom'
    if (o.limitation === 'cpu' || (o.lossPct ?? 0) >= 5) return 'ruim'
    if (o.limitation === 'bandwidth' || (o.lossPct ?? 0) >= 1.5) return 'atencao'
    return 'bom'
  })
  return overallHealth(each) as Health
}

/** Quem está compartilhando a tela agora, entre as outras pessoas. */
export const sharersOf = (peers: PeerView[]): PeerView[] => peers.filter((p) => p.state.sharing)

/** Veredito da tela de uma pessoa (o mesmo que o painel mostra). */
export function peerVerdict(p: PeerView): Verdict {
  return assess(p.name, p.diag.inbound, p.diag.history.slice(-15), p.state.send)
}

/** Saúde geral: quem compartilha para mim e o que eu envio. */
export function signalHealth(peers: PeerView[], send?: SendDiag): Health | 'idle' {
  return overallHealth([...sharersOf(peers).map((p) => peerVerdict(p).health), sendHealth(send)])
}

/** Quantas barras da antena acendem para cada saúde. */
export const LIT: Record<Health | 'idle', number> = { bom: 4, atencao: 2, ruim: 1, idle: 4 }

export function summaryText(health: Health | 'idle', ctx: { receiving: number; sending: boolean }): string {
  if (health === 'idle') return 'Ninguém está compartilhando. Quando alguém começar, o sinal aparece aqui.'
  if (health === 'bom') return ctx.receiving ? 'Tudo certo com a imagem que chega.' : 'Tudo certo com a imagem que você envia.'
  if (health === 'atencao') return 'Algo está oscilando. Veja os detalhes abaixo.'
  return ctx.sending && !ctx.receiving ? 'A sua imagem está sofrendo. Veja o que fazer abaixo.' : 'A imagem está sofrendo. Veja o que fazer abaixo.'
}

export interface Bar {
  kind: 'empty' | 'gap' | 'bar'
  /** altura em blocos (0 a rows); 0 em 'bar' = valor zero (só o traço da base) */
  h: number
}

/**
 * Colunas do mini-gráfico: as últimas `cols` leituras, a mais nova à direita.
 * Valor ausente vira 'gap'; colunas sem leitura ainda ficam 'empty'. Alturas são inteiras (pixel art).
 */
export function chartBars(values: (number | undefined)[], opts: { cols?: number; rows?: number; max?: number; minMax?: number } = {}): Bar[] {
  const cols = opts.cols ?? 30
  const rows = opts.rows ?? 12
  const tail = values.slice(-cols)
  const top = opts.max ?? Math.max(opts.minMax ?? 1, ...tail.filter((v): v is number => v !== undefined && Number.isFinite(v)))
  const out: Bar[] = Array.from({ length: cols - tail.length }, () => ({ kind: 'empty', h: 0 }))
  for (const v of tail) {
    if (v === undefined || !Number.isFinite(v)) out.push({ kind: 'gap', h: 0 })
    else out.push({ kind: 'bar', h: v <= 0 ? 0 : Math.min(rows, Math.max(1, Math.round((v / top) * rows))) })
  }
  return out
}

const ROUTE_LABEL: Record<Route, string> = { conectando: 'conectando', direto: 'direto', relay: 'via relay', falhou: 'falhou' }
const HOLD_TEXT: Record<Limitation, string> = { none: 'nada', bandwidth: 'a internet', cpu: 'o processador', other: 'o navegador' }
const SENDER_LIMIT: Record<Limitation, string> = {
  none: '',
  cpu: 'o PC está no limite',
  bandwidth: 'o upload está no limite',
  other: 'o navegador está segurando a qualidade'
}

/** "Do lado de Pedro: enviando 1080p 60 · automático" (ou só o que se sabe). */
export function senderLine(name: string, send: SendSummary): string {
  let what = 'enviando'
  if (send.lvl) what += ` ${send.lvl} · automático`
  else if (send.h) what += ` ${send.h}p${send.fps !== undefined ? ` ${Math.round(send.fps)}` : ''}`
  const lim = SENDER_LIMIT[send.lim]
  return `Do lado de ${name}: ${what}${lim ? `, ${lim}` : ''}`
}

export const freezesIn = (history: InboundStats[]): number => history.reduce((a, r) => a + r.freezes, 0)

export interface ReportPeer {
  name: string
  verdict: Verdict
  inbound?: InboundStats
  history: InboundStats[]
  send?: SendSummary
}

export interface ReportInput {
  at: number
  me: string
  peers: ReportPeer[]
  send?: SendDiag
  events: DiagEvent[]
}

function outLine(o: OutboundStats | undefined): string {
  if (!o) return 'sem leitura ainda'
  const parts = [`enviando ${fmtMbps(o.kbps)}`]
  if (o.availableKbps !== undefined) parts.push(`banda estimada ${fmtMbps(o.availableKbps)}`)
  if (o.lossPct !== undefined) parts.push(`perda ${fmtPct(o.lossPct)}`)
  if (o.rttMs !== undefined) parts.push(`atraso ${o.rttMs} ms`)
  parts.push(`segurando: ${HOLD_TEXT[o.limitation]}`)
  return parts.join(', ')
}

/** Texto puro para colar numa conversa: métricas atuais e os últimos 20 eventos (mais novo primeiro). */
export function buildReport(r: ReportInput): string {
  const L: string[] = []
  L.push('JanJa, relatório de sinal')
  L.push(`Gerado às ${fmtClock(r.at)} por ${r.me}`)
  L.push('')
  L.push('Recebendo')
  if (!r.peers.length) L.push('- Ninguém está compartilhando.')
  for (const p of r.peers) {
    const i = p.inbound
    L.push(`- ${p.name}${i ? ` (${ROUTE_LABEL[i.route]})` : ''}: ${p.verdict.title}`)
    if (i) {
      L.push(
        `  Imagem ${fmtRes(i.width, i.height, i.fps)}; taxa ${fmtMbps(i.kbps)}; perda ${i.lossPct !== undefined ? fmtPct(i.lossPct) : 'sem dados'}; ` +
          `atraso ${i.rttMs !== undefined ? `${i.rttMs} ms` : 'sem dados'}${i.jitterMs !== undefined ? ` (± ${i.jitterMs} ms)` : ''}; ` +
          `travadas ${freezesIn(p.history)} no último minuto`
      )
    }
    if (p.send) L.push(`  ${senderLine(p.name, p.send)}`)
  }
  if (r.send) {
    L.push('')
    L.push(`Enviando (${r.send.mode === 'auto' ? 'automático' : 'fixo'}, ${r.send.levelLabel})`)
    if (!r.send.viewers.length) L.push('- Ninguém está assistindo.')
    for (const v of r.send.viewers) L.push(`- ${v.name}: ${outLine(v.out)}`)
  }
  L.push('')
  L.push('Diário (últimos 20 eventos)')
  const ev = r.events.slice(-20).reverse()
  if (!ev.length) L.push('- Nenhum evento.')
  for (const e of ev) L.push(`${fmtClock(e.at)}  ${e.text}`)
  return L.join('\n')
}

// ---------- ícones do diário: 12×12, desenhados bloco a bloco ----------

/** '#' = pixel aceso. Cada tipo de evento tem o seu desenho. */
export const GLYPHS: Record<DiagKind, string[]> = {
  up: ['............', '.....##.....', '....####....', '...######...', '..########..', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '............', '............'],
  down: ['............', '............', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '..########..', '...######...', '....####....', '.....##.....', '............'],
  perda: ['............', '.##......##.', '.###....###.', '..###..###..', '...######...', '....####....', '....####....', '...######...', '..###..###..', '.###....###.', '.##......##.', '............'],
  travada: ['............', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '............', '............'],
  cpu: ['............', '....#..#....', '....#..#....', '...######...', '.###....###.', '...#.##.#...', '...#.##.#...', '.###....###.', '...######...', '....#..#....', '....#..#....', '............'],
  banda: ['............', '.##########.', '............', '.....##.....', '....####....', '...######...', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '............', '............'],
  relay: ['............', '.##......##.', '.##......##.', '..##....##..', '...##..##...', '....####....', '....####....', '.....##.....', '.....##.....', '....####....', '............', '............'],
  direto: ['............', '............', '............', '###......###', '############', '############', '###......###', '............', '............', '............', '............', '............'],
  tela: ['............', '...#....#...', '....#..#....', '.##########.', '.#........#.', '.#.######.#.', '.#.######.#.', '.#.######.#.', '.#........#.', '.##########.', '...##..##...', '............'],
  info: ['............', '.....##.....', '.....##.....', '............', '....###.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '....####....', '............', '............']
}

/** Retângulos (um por trecho contínuo de cada linha) para desenhar um glifo em <rect>. */
export function glyphRects(rows: string[]): { x: number; y: number; w: number }[] {
  const out: { x: number; y: number; w: number }[] = []
  rows.forEach((row, y) => {
    for (const m of row.matchAll(/#+/g)) out.push({ x: m.index, y, w: m[0].length })
  })
  return out
}


export const GLYPH_RECTS = Object.fromEntries((Object.keys(GLYPHS) as DiagKind[]).map((k) => [k, glyphRects(GLYPHS[k])])) as Record<DiagKind, ReturnType<typeof glyphRects>>

export const ROUTE_TEXT = ROUTE_LABEL
export const HOLD = HOLD_TEXT
