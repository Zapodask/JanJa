import { describe, expect, it } from 'vitest'
import { assess, fmtMbps, fmtPct, fmtRes, readPair, readStats, type Counters, type InboundStats, type StatRow } from '../src/web/rtc/stats'

const pairRows = (remoteType = 'host', rtt = 0.04, avail?: number): StatRow[] => [
  { id: 'T', type: 'transport', selectedCandidatePairId: 'P' },
  { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R', currentRoundTripTime: rtt, availableOutgoingBitrate: avail },
  { id: 'L', type: 'local-candidate', candidateType: 'host' },
  { id: 'R', type: 'remote-candidate', candidateType: remoteType }
]

const inbound = (o: Partial<StatRow> = {}): StatRow => ({
  id: 'IN1',
  type: 'inbound-rtp',
  kind: 'video',
  trackIdentifier: 'tela',
  bytesReceived: 1_000_000,
  packetsReceived: 1000,
  packetsLost: 0,
  framesDecoded: 600,
  freezeCount: 0,
  frameWidth: 1920,
  frameHeight: 1080,
  jitter: 0.004,
  ...o
})

describe('readPair', () => {
  it('direto, atraso em ms e banda estimada em kbps', () => {
    expect(readPair(pairRows('host', 0.0426, 5_000_000))).toEqual({ route: 'direto', rttMs: 43, availableKbps: 5000 })
  })
  it('relay quando um dos candidatos é relay', () => {
    expect(readPair(pairRows('relay')).route).toBe('relay')
  })
  it('sem par escolhido: conectando; cai no par nomeado se não houver transport', () => {
    expect(readPair([]).route).toBe('conectando')
    const rows = pairRows().slice(1).map((r) => (r.id === 'P' ? { ...r, nominated: true, state: 'succeeded' } : r))
    expect(readPair(rows).route).toBe('direto')
  })
})

describe('readStats: recebimento', () => {
  const prev: Counters = { at: 0, inBytes: 0, inPackets: 0, inLost: 0, inFrames: 0, freezes: 0, outBytes: 0 }

  it('primeira leitura: sem taxa nem perda, só o que o relatório diz', () => {
    const r = readStats([...pairRows(), inbound()], undefined, 1000)
    expect(r.inbound).toMatchObject({ route: 'direto', rttMs: 40, width: 1920, height: 1080, jitterMs: 4, freezes: 0 })
    expect(r.inbound?.kbps).toBeUndefined()
    expect(r.inbound?.lossPct).toBeUndefined()
    expect(r.counters).toMatchObject({ at: 1000, inBytes: 1_000_000, inPackets: 1000 })
  })

  it('kbps e fps pela diferença de contadores', () => {
    const r = readStats([...pairRows(), inbound({ bytesReceived: 500_000, framesDecoded: 120, packetsReceived: 500 })], { ...prev, at: 0 }, 2000)
    expect(r.inbound?.kbps).toBe(2000) // 500 kB em 2 s
    expect(r.inbound?.fps).toBe(60)
  })

  it('usa framesPerSecond do relatório quando existe', () => {
    const r = readStats([...pairRows(), inbound({ framesPerSecond: 29.96 })], prev, 2000)
    expect(r.inbound?.fps).toBe(30)
  })

  it('perda em % no intervalo (perdidos / esperados)', () => {
    const before: Counters = { ...prev, inPackets: 900, inLost: 10 }
    const r = readStats([...pairRows(), inbound({ packetsReceived: 1000, packetsLost: 20 })], before, 2000)
    // 100 recebidos, 10 perdidos novos -> 10 de 110 = 9,1%
    expect(r.inbound?.lossPct).toBe(9.1)
  })

  it('sem perda nova: 0%', () => {
    const before: Counters = { ...prev, inPackets: 900, inLost: 5 }
    const r = readStats([...pairRows(), inbound({ packetsLost: 5 })], before, 2000)
    expect(r.inbound?.lossPct).toBe(0)
  })

  it('travadas novas no intervalo', () => {
    const before: Counters = { ...prev, freezes: 2 }
    const r = readStats([...pairRows(), inbound({ freezeCount: 5 })], before, 2000)
    expect(r.inbound?.freezes).toBe(3)
  })

  it('rota relay e codec', () => {
    const rows = [...pairRows('relay'), inbound({ codecId: 'C1' }), { id: 'C1', type: 'codec', mimeType: 'video/H264' }]
    const r = readStats(rows, undefined, 1000)
    expect(r.inbound?.route).toBe('relay')
    expect(r.inbound?.codec).toBe('H264')
  })

  it('filtra a trilha da tela e deixa a câmera de fora', () => {
    const cam = inbound({ id: 'IN2', trackIdentifier: 'cam', bytesReceived: 9_000_000, frameHeight: 360 })
    const r = readStats([...pairRows(), inbound(), cam], undefined, 1000, { inTrack: (x) => x.trackIdentifier === 'tela' })
    expect(r.inbound?.height).toBe(1080)
    expect(r.counters.inBytes).toBe(1_000_000)
    // sem filtro pega o maior fluxo
    expect(readStats([...pairRows(), inbound(), cam], undefined, 1000).inbound?.height).toBe(360)
  })

  it('aceita Map e ignora áudio', () => {
    const map = new Map<string, StatRow>([...pairRows(), inbound(), { id: 'A', type: 'inbound-rtp', kind: 'audio', bytesReceived: 5 }].map((r) => [r.id, r]))
    expect(readStats(map, undefined, 1000).inbound?.width).toBe(1920)
  })

  it('sem vídeo entrando: inbound indefinido', () => {
    expect(readStats(pairRows(), undefined, 1000).inbound).toBeUndefined()
  })
})

describe('readStats: envio', () => {
  const out = (o: Partial<StatRow> = {}): StatRow => ({
    id: 'OUT1',
    type: 'outbound-rtp',
    kind: 'video',
    mediaSourceId: 'S1',
    bytesSent: 2_000_000,
    framesPerSecond: 58,
    frameWidth: 1920,
    frameHeight: 1080,
    qualityLimitationReason: 'none',
    ...o
  })
  const prev: Counters = { at: 0, inBytes: 0, inPackets: 0, inLost: 0, inFrames: 0, freezes: 0, outBytes: 1_000_000 }

  it('taxa, perda relatada pelo outro lado e banda estimada', () => {
    const rows = [...pairRows('host', 0.03, 8_000_000), out(), { id: 'RI', type: 'remote-inbound-rtp', localId: 'OUT1', fractionLost: 0.042 }]
    const r = readStats(rows, prev, 2000)
    expect(r.outbound).toMatchObject({ kbps: 4000, fps: 58, height: 1080, lossPct: 4.2, availableKbps: 8000, limitation: 'none' })
  })

  it.each([
    ['cpu', 'cpu'],
    ['bandwidth', 'bandwidth'],
    ['other', 'other'],
    ['none', 'none'],
    [undefined, 'none']
  ])('limitação %s', (reason, expected) => {
    const r = readStats([...pairRows(), out({ qualityLimitationReason: reason })], prev, 2000)
    expect(r.outbound?.limitation).toBe(expected)
  })

  it('filtra pela trilha de saída', () => {
    const other = out({ id: 'OUT2', mediaSourceId: 'S2', bytesSent: 50_000_000, frameHeight: 360 })
    const r = readStats([...pairRows(), out(), other], undefined, 1000, { outTrack: (x) => x.mediaSourceId === 'S1' })
    expect(r.outbound?.height).toBe(1080)
  })
})

describe('assess: vereditos', () => {
  const base: InboundStats = { route: 'direto', rttMs: 40, freezes: 0, lossPct: 0 }
  const calm = Array.from({ length: 10 }, () => base)

  it('sem imagem ainda: atenção', () => {
    expect(assess('Bia', undefined, []).health).toBe('atencao')
  })
  it('CPU de quem envia vence tudo', () => {
    const v = assess('Bia', base, calm, { lim: 'cpu' })
    expect(v.health).toBe('ruim')
    expect(v.title).toContain('Bia')
  })
  it('perda média de 5% ou mais é ruim', () => {
    const lossy = Array.from({ length: 10 }, () => ({ ...base, lossPct: 6 }))
    const v = assess('Bia', lossy[0], lossy)
    expect(v.health).toBe('ruim')
    expect(v.title).toContain('6,0%')
  })
  it('upload no limite: atenção', () => {
    expect(assess('Bia', base, calm, { lim: 'bandwidth' })).toMatchObject({ health: 'atencao' })
  })
  it('3 travadas ou mais: atenção', () => {
    const f = [{ ...base, freezes: 2 }, { ...base, freezes: 1 }]
    expect(assess('Bia', base, f).title).toContain('3 travadas')
  })
  it('perda entre 1,5% e 5%: atenção', () => {
    const l = Array.from({ length: 5 }, () => ({ ...base, lossPct: 2 }))
    expect(assess('Bia', base, l)).toMatchObject({ health: 'atencao' })
  })
  it('atraso oscilando 80 ms ou mais: atenção', () => {
    const rtts = [20, 120, 30, 100].map((rttMs) => ({ ...base, rttMs }))
    expect(assess('Bia', base, rtts).title).toContain('oscilando')
  })
  it('relay sem problemas: bom, avisando do relay', () => {
    const v = assess('Bia', { ...base, route: 'relay' }, calm)
    expect(v.health).toBe('bom')
    expect(v.title).toContain('relay')
  })
  it('tudo limpo: sinal limpo', () => {
    expect(assess('Bia', base, calm, { lim: 'none' })).toMatchObject({ health: 'bom', title: 'Sinal limpo' })
  })
})

describe('formatação', () => {
  it('porcentagem, taxa e resolução', () => {
    expect(fmtPct(4.2)).toBe('4,2%')
    expect(fmtPct(12.4)).toBe('12%')
    expect(fmtMbps(undefined)).toBe('sem dados')
    expect(fmtMbps(800)).toBe('800 kbps')
    expect(fmtMbps(2500)).toBe('2,5 Mbps')
    expect(fmtRes()).toBe('sem imagem')
    expect(fmtRes(1920, 1080, 59.6)).toBe('1920×1080 · 60 fps')
  })
})
