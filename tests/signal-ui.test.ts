import { describe, expect, it } from 'vitest'
import type { DiagEvent, SendDiag } from '../src/web/rtc/diag'
import type { PeerView } from '../src/web/rtc/PeerManager'
import type { InboundStats, OutboundStats } from '../src/web/rtc/stats'
import {
  GLYPHS,
  buildReport,
  chartBars,
  fmtClock,
  glyphRects,
  overallHealth,
  senderLine,
  sendHealth,
  signalHealth,
  summaryText
} from '../src/web/ui/signalLogic'

const inb = (o: Partial<InboundStats> = {}): InboundStats => ({ route: 'direto', freezes: 0, ...o })
const out = (o: Partial<OutboundStats> = {}): OutboundStats => ({ route: 'direto', limitation: 'none', ...o })
const peer = (name: string, sharing: boolean, diag: { inbound?: InboundStats; history: InboundStats[] }, send?: PeerView['state']['send']) =>
  ({ id: name, name, route: 'direto', state: { sharing, micMuted: true, send }, diag }) as unknown as PeerView

describe('fmtClock', () => {
  it('hora local com zeros à esquerda', () => {
    expect(fmtClock(new Date(2026, 10, 8, 9, 5, 7).getTime())).toBe('09:05:07')
    expect(fmtClock(new Date(2026, 10, 8, 23, 59, 0).getTime())).toBe('23:59:00')
  })
})

describe('saúde geral', () => {
  it('pega a pior; vazio é idle', () => {
    expect(overallHealth([])).toBe('idle')
    expect(overallHealth([undefined])).toBe('idle')
    expect(overallHealth(['bom', 'atencao', 'bom'])).toBe('atencao')
    expect(overallHealth(['bom', undefined, 'ruim', 'atencao'])).toBe('ruim')
  })
  it('sendHealth olha limite e perda de cada espectador', () => {
    const v = (o?: OutboundStats) => ({ id: 'x', name: 'x', out: o, history: [] })
    const d = (...viewers: ReturnType<typeof v>[]): SendDiag => ({ mode: 'auto', levelLabel: '1080p 30', viewers })
    expect(sendHealth(undefined)).toBeUndefined()
    expect(sendHealth(d())).toBeUndefined()
    expect(sendHealth(d(v(out())))).toBe('bom')
    expect(sendHealth(d(v(out({ lossPct: 2 }))))).toBe('atencao')
    expect(sendHealth(d(v(out()), v(out({ limitation: 'bandwidth' }))))).toBe('atencao')
    expect(sendHealth(d(v(out({ limitation: 'cpu' }))))).toBe('ruim')
    expect(sendHealth(d(v(out({ lossPct: 6 }))))).toBe('ruim')
  })
  it('signalHealth ignora quem não compartilha e junta com o envio', () => {
    const calm = { inbound: inb({ lossPct: 0 }), history: [inb({ lossPct: 0 })] }
    const lossy = { inbound: inb({ lossPct: 8 }), history: [inb({ lossPct: 8 }), inb({ lossPct: 9 })] }
    expect(signalHealth([peer('Bia', false, lossy)])).toBe('idle')
    expect(signalHealth([peer('Bia', true, calm)])).toBe('bom')
    expect(signalHealth([peer('Bia', true, calm), peer('Caio', true, lossy)])).toBe('ruim')
    expect(signalHealth([peer('Bia', true, calm)], { mode: 'fixo', levelLabel: 'jogo', viewers: [{ id: 'b', name: 'Bia', out: out({ limitation: 'cpu' }), history: [] }] })).toBe('ruim')
  })
  it('frases de resumo', () => {
    expect(summaryText('idle', { receiving: 0, sending: false })).toMatch(/Ninguém/)
    expect(summaryText('bom', { receiving: 1, sending: false })).toMatch(/Tudo certo/)
    expect(summaryText('ruim', { receiving: 0, sending: true })).toMatch(/sua imagem/)
  })
})

describe('chartBars', () => {
  it('completa com colunas vazias à esquerda e mantém a mais nova à direita', () => {
    const b = chartBars([1, 2, 4], { cols: 5, rows: 4, max: 4 })
    expect(b.map((x) => x.kind)).toEqual(['empty', 'empty', 'bar', 'bar', 'bar'])
    expect(b.map((x) => x.h)).toEqual([0, 0, 1, 2, 4])
  })
  it('corta para as últimas colunas', () => {
    const b = chartBars([1, 2, 3, 4, 5, 6], { cols: 3, rows: 6, max: 6 })
    expect(b.map((x) => x.h)).toEqual([4, 5, 6])
  })
  it('valor ausente vira gap; zero vira barra de altura 0; positivo mínimo é 1', () => {
    const b = chartBars([undefined, 0, 0.01], { cols: 3, rows: 10, max: 100 })
    expect(b.map((x) => x.kind)).toEqual(['gap', 'bar', 'bar'])
    expect(b.map((x) => x.h)).toEqual([0, 0, 1])
  })
  it('escala pelo maior valor, respeitando o piso minMax e o teto de linhas', () => {
    expect(chartBars([5], { cols: 1, rows: 10, minMax: 10 })[0].h).toBe(5)
    expect(chartBars([50], { cols: 1, rows: 10, minMax: 10 })[0].h).toBe(10)
    expect(chartBars([20], { cols: 1, rows: 10, max: 10 })[0].h).toBe(10)
  })
  it('usa 30 colunas por padrão', () => {
    expect(chartBars([1, 2]).length).toBe(30)
  })
})

describe('glifos do diário', () => {
  it('todos têm 12×12 e algum pixel aceso', () => {
    for (const [k, rows] of Object.entries(GLYPHS)) {
      expect(rows.length, k).toBe(12)
      for (const r of rows) expect(r.length, k).toBe(12)
      expect(glyphRects(rows).length, k).toBeGreaterThan(0)
    }
  })
  it('glyphRects junta trechos contínuos', () => {
    expect(glyphRects(['.##..#', '######'])).toEqual([
      { x: 1, y: 0, w: 2 },
      { x: 5, y: 0, w: 1 },
      { x: 0, y: 1, w: 6 }
    ])
  })
})

describe('textos', () => {
  it('senderLine', () => {
    expect(senderLine('Pedro', { lim: 'none', lvl: '1080p 60' })).toBe('Do lado de Pedro: enviando 1080p 60 · automático')
    expect(senderLine('Pedro', { lim: 'cpu', h: 720, fps: 29.6 })).toBe('Do lado de Pedro: enviando 720p 30, o PC está no limite')
    expect(senderLine('Pedro', { lim: 'bandwidth' })).toBe('Do lado de Pedro: enviando, o upload está no limite')
  })
})

describe('buildReport', () => {
  const at = new Date(2026, 10, 8, 21, 4, 10).getTime()
  const ev = (id: number, text: string): DiagEvent => ({ id, at: new Date(2026, 10, 8, 21, 0, id).getTime(), kind: 'info', text })
  const history = [inb({ freezes: 1 }), inb({ freezes: 2 })]
  const base = {
    at,
    me: 'Pedro',
    peers: [
      {
        name: 'Bia',
        verdict: { health: 'atencao' as const, title: '3 travadas no último minuto', advice: 'x' },
        inbound: inb({ width: 1920, height: 1080, fps: 30, kbps: 4800, lossPct: 0.2, rttMs: 23, jitterMs: 4 }),
        history,
        send: { lim: 'none' as const, lvl: '1080p 30' }
      }
    ],
    events: [] as DiagEvent[]
  }
  it('inclui métricas, o lado de quem envia e vazio do diário', () => {
    const t = buildReport(base)
    expect(t).toContain('Gerado às 21:04:10 por Pedro')
    expect(t).toContain('- Bia (direto): 3 travadas no último minuto')
    expect(t).toContain('Imagem 1920×1080 · 30 fps; taxa 4,8 Mbps; perda 0,2%; atraso 23 ms (± 4 ms); travadas 3 no último minuto')
    expect(t).toContain('Do lado de Bia: enviando 1080p 30 · automático')
    expect(t).toContain('- Nenhum evento.')
    expect(t).not.toContain('Enviando')
  })
  it('só os 20 últimos eventos, o mais novo primeiro', () => {
    const events = Array.from({ length: 25 }, (_, i) => ev(i, `evento ${i}`))
    const lines = buildReport({ ...base, events }).split('\n')
    const i = lines.indexOf('Diário (últimos 20 eventos)')
    const rest = lines.slice(i + 1)
    expect(rest.length).toBe(20)
    expect(rest[0]).toBe('21:00:24  evento 24')
    expect(rest[19]).toBe('21:00:05  evento 5')
  })
  it('seção Enviando quando eu compartilho', () => {
    const send: SendDiag = {
      mode: 'auto',
      levelLabel: '720p 30',
      viewers: [{ id: 'b', name: 'Bia', out: out({ kbps: 2400, availableKbps: 6000, lossPct: 1.2, limitation: 'bandwidth' }), history: [] }]
    }
    const t = buildReport({ ...base, peers: [], send })
    expect(t).toContain('- Ninguém está compartilhando.')
    expect(t).toContain('Enviando (automático, 720p 30)')
    expect(t).toContain('- Bia: enviando 2,4 Mbps, banda estimada 6,0 Mbps, perda 1,2%, segurando: a internet')
  })
  it('sem emoji nem setas', () => {
    expect(buildReport(base)).not.toMatch(/[→←↑↓\u{1F300}-\u{1FAFF}]/u)
  })
})
