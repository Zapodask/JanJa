import '@fontsource-variable/pixelify-sans'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { PeerView } from '../rtc/PeerManager'
import type { DiagEvent, DiagKind, SendDiag } from '../rtc/diag'
import { fmtMbps, fmtPct, fmtRes, type Health } from '../rtc/stats'
import { Icon, SignalBars } from './icons'
import {
  GLYPH_RECTS,
  HOLD,
  LIT,
  ROUTE_TEXT as ROUTE_LABEL,
  buildReport,
  chartBars,
  fmtClock,
  freezesIn,
  peerVerdict,
  senderLine,
  sendHealth,
  sharersOf,
  signalHealth,
  summaryText
} from './signalLogic'
import { useToast } from './Toasts'

function EventGlyph({ kind }: { kind: DiagKind }) {
  return (
    <svg className="sig-glyph" width={12} height={12} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
      {GLYPH_RECTS[kind].map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill="currentColor" />
      ))}
    </svg>
  )
}

// ---------- peças visuais ----------

type Tone = 'ok' | 'warn' | 'bad' | 'plain'
const TONE_OF: Record<Health, Tone> = { bom: 'ok', atencao: 'warn', ruim: 'bad' }
const lossTone = (v: number | undefined): Tone => (v === undefined ? 'plain' : v >= 5 ? 'bad' : v >= 1.5 ? 'warn' : 'ok')

const COLS = 30
const ROWS = 12

/** Gráfico de barrinhas: cada leitura (2 s) é uma coluna de 3 px; 30 colunas ≈ 1 minuto. */
function PixelChart({ values, tone = 'plain', max, minMax, label }: { values: (number | undefined)[]; tone?: Tone; max?: number; minMax?: number; label: string }) {
  const bars = chartBars(values, { cols: COLS, rows: ROWS, max, minMax })
  const last = bars.length - 1
  return (
    <svg className={`sig-chart t-${tone}`} viewBox={`0 0 ${COLS * 4 - 1} ${ROWS * 2}`} shapeRendering="crispEdges" role="img" aria-label={label}>
      <rect className="base" x={0} y={ROWS * 2 - 1} width={COLS * 4 - 1} height={1} />
      {bars.map((b, i) => {
        if (b.kind === 'empty') return null
        if (b.kind === 'gap') return <rect key={i} className="gap" x={i * 4} y={ROWS * 2 - 3} width={3} height={2} />
        const h = b.h * 2
        return <rect key={i} className={i === last ? 'now' : undefined} x={i * 4} y={ROWS * 2 - Math.max(h, 1)} width={3} height={Math.max(h, 1)} />
      })}
    </svg>
  )
}

function Metric({ name, value, sub, ...chart }: { name: string; value: string; sub?: string } & Parameters<typeof PixelChart>[0]) {
  return (
    <div className="sig-m">
      <span className="sig-m-l">{name}</span>
      <strong className="sig-m-v">{value}</strong>
      {sub && <small className="sig-m-s">{sub}</small>}
      <PixelChart {...chart} />
    </div>
  )
}

function PeerCard({ p }: { p: PeerView }) {
  const v = peerVerdict(p)
  const i = p.diag.inbound
  const h = p.diag.history
  const frz = freezesIn(h)
  return (
    <article className={`sig-card h-${v.health}`}>
      <header className="sig-card-h">
        <strong>{p.name}</strong>
        <span className={`sig-route r-${i?.route ?? 'conectando'}`}>{ROUTE_LABEL[i?.route ?? p.route]}</span>
      </header>
      <p className="sig-verdict">{v.title}</p>
      <p className="sig-advice">{v.advice}</p>
      <div className="sig-grid">
        <Metric name="Imagem" value={fmtRes(i?.width, i?.height, i?.fps)} values={h.map((r) => r.fps)} minMax={30} label={`Quadros por segundo de ${p.name}`} />
        <Metric name="Taxa" value={fmtMbps(i?.kbps)} values={h.map((r) => r.kbps)} minMax={500} label={`Taxa de ${p.name}`} />
        <Metric
          name="Perda"
          value={i?.lossPct !== undefined ? fmtPct(i.lossPct) : 'sem dados'}
          tone={lossTone(i?.lossPct)}
          values={h.map((r) => r.lossPct)}
          max={10}
          label={`Perda de pacotes de ${p.name}`}
        />
        <Metric
          name="Atraso"
          value={i?.rttMs !== undefined ? `${i.rttMs} ms` : 'sem dados'}
          sub={i?.jitterMs !== undefined ? `± ${i.jitterMs} ms` : undefined}
          values={h.map((r) => r.rttMs)}
          minMax={50}
          label={`Atraso até ${p.name}`}
        />
        <Metric
          name="Travadas"
          value={String(frz)}
          sub="no último minuto"
          tone={frz >= 3 ? 'warn' : frz > 0 ? 'plain' : 'ok'}
          values={h.map((r) => r.freezes)}
          minMax={3}
          label={`Travadas de ${p.name}`}
        />
      </div>
      {p.state.send && <p className="sig-from">{senderLine(p.name, p.state.send)}</p>}
    </article>
  )
}

function ViewerRow({ v }: { v: SendDiag['viewers'][number] }) {
  const o = v.out
  return (
    <li className="sig-view">
      <div className="sig-view-h">
        <strong>{v.name}</strong>
        <span className="sig-route">{o ? ROUTE_LABEL[o.route] : 'conectando'}</span>
      </div>
      <dl className="sig-kv">
        <div>
          <dt>Banda estimada</dt>
          <dd>{o?.availableKbps !== undefined ? fmtMbps(o.availableKbps) : 'sem dados'}</dd>
        </div>
        <div>
          <dt>Perda relatada</dt>
          <dd className={`t-${lossTone(o?.lossPct)}`}>{o?.lossPct !== undefined ? fmtPct(o.lossPct) : 'sem dados'}</dd>
        </div>
        <div>
          <dt>Segurando</dt>
          <dd className={o && o.limitation !== 'none' ? 't-warn' : undefined}>{o ? HOLD[o.limitation] : 'nada'}</dd>
        </div>
      </dl>
      <PixelChart values={v.history.map((r) => r.kbps)} minMax={500} label={`Taxa enviada para ${v.name}`} />
    </li>
  )
}

interface Props {
  peers: PeerView[]
  sendDiag?: SendDiag
  log: DiagEvent[]
  me: string
  showStats: boolean
  onShowStats: (on: boolean) => void
  onClose: () => void
}

/** A gaveta "Sinal": como a saúde da conexão está, em português, com um diário do que aconteceu. */
export function SignalPanel({ peers, sendDiag, log, me, showStats, onShowStats, onClose }: Props) {
  const toast = useToast()
  const root = useRef<HTMLElement>(null)
  const sharers = useMemo(() => sharersOf(peers), [peers])
  const health = signalHealth(peers, sendDiag)

  useEffect(() => {
    root.current?.focus({ preventScroll: true })
  }, [])

  const copyReport = useCallback(async () => {
    const text = buildReport({
      at: Date.now(),
      me,
      peers: sharers.map((p) => ({ name: p.name, verdict: peerVerdict(p), inbound: p.diag.inbound, history: p.diag.history, send: p.state.send })),
      send: sendDiag,
      events: log
    })
    try {
      await navigator.clipboard.writeText(text)
      toast('Relatório copiado', 'ok')
    } catch {
      window.prompt('Copie o relatório:', text)
    }
  }, [me, sharers, sendDiag, log, toast])

  const events = useMemo(() => [...log].reverse(), [log])
  const tone = health === 'idle' ? 'plain' : TONE_OF[health]

  return (
    <aside ref={root} className={`sig-panel t-${tone}`} role="complementary" aria-label="Sinal da conexão" tabIndex={-1}>
      <header className="sig-head">
        <SignalBars lit={LIT[health]} size={44} className="sig-big" />
        <div className="sig-head-t">
          <h2 className="sig-title">Sinal</h2>
          <p>{summaryText(health, { receiving: sharers.length, sending: !!sendDiag })}</p>
        </div>
        <button className="icon-btn" onClick={onClose} data-tip="Fechar (Esc)" data-tip-pos="left" aria-label="Fechar o painel do sinal">
          <Icon name="x" size={20} />
        </button>
      </header>

      <div className="sig-body">
        <section className="sig-sec" aria-labelledby="sig-h-in">
          <h3 id="sig-h-in">Recebendo</h3>
          {sharers.length === 0 ? <p className="sig-empty">Ninguém está compartilhando a tela agora.</p> : sharers.map((p) => <PeerCard key={p.id} p={p} />)}
        </section>

        {sendDiag && (
          <section className="sig-sec" aria-labelledby="sig-h-out">
            <h3 id="sig-h-out">Enviando</h3>
            <article className={`sig-card h-${sendHealth(sendDiag) ?? 'bom'}`}>
              <header className="sig-card-h">
                <strong>{sendDiag.mode === 'auto' ? 'Automático' : 'Qualidade fixa'}</strong>
                <span className="sig-level">{sendDiag.levelLabel}</span>
              </header>
              <p className="sig-advice">
                {sendDiag.mode === 'auto' ? 'A imagem sobe e desce sozinha conforme a internet e o PC.' : 'Você escolheu esta qualidade; ela não muda sozinha.'}
              </p>
              {sendDiag.viewers.length === 0 ? (
                <p className="sig-empty">Ninguém está assistindo ainda.</p>
              ) : (
                <ul className="sig-views">
                  {sendDiag.viewers.map((v) => (
                    <ViewerRow key={v.id} v={v} />
                  ))}
                </ul>
              )}
            </article>
          </section>
        )}

        <section className="sig-sec" aria-labelledby="sig-h-log">
          <h3 id="sig-h-log">Diário</h3>
          {events.length === 0 ? (
            <p className="sig-empty">Nenhum evento ainda. Tudo calmo por aqui.</p>
          ) : (
            <ol className="sig-log" aria-label="Eventos recentes, do mais novo ao mais antigo">
              {events.map((e) => (
                <li key={e.id} className={`sig-ev k-${e.kind}`}>
                  <time className="sig-t" dateTime={new Date(e.at).toISOString()}>
                    {fmtClock(e.at)}
                  </time>
                  <EventGlyph kind={e.kind} />
                  <span className="sig-ev-x">{e.text}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <footer className="sig-foot">
        <div className="sig-switch-row">
          <span id="sig-sw-l">Mostrar números nas telas e na lista</span>
          <button type="button" role="switch" aria-checked={showStats} aria-labelledby="sig-sw-l" className="sig-switch" onClick={() => onShowStats(!showStats)}>
            <i aria-hidden="true" />
          </button>
        </div>
        <button className="wide" onClick={() => void copyReport()}>
          <Icon name="copy" size={16} /> Copiar relatório
        </button>
      </footer>
    </aside>
  )
}
