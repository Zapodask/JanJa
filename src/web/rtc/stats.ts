/**
 * Leitura do getStats do WebRTC em números que dá para mostrar e decidir em cima.
 * Tudo aqui é puro: recebe as linhas do relatório (e a leitura anterior) e devolve métricas.
 */

export type Route = 'conectando' | 'direto' | 'relay' | 'falhou'
export type Limitation = 'none' | 'cpu' | 'bandwidth' | 'other'

/** Linha do RTCStatsReport, sem depender dos tipos do DOM (dá para testar no Node). */
export type StatRow = { id: string; type: string; [k: string]: unknown }

/** Contadores crus de uma leitura, para calcular a diferença na próxima. */
export interface Counters {
  at: number
  inBytes: number
  inPackets: number
  inLost: number
  inFrames: number
  freezes: number
  outBytes: number
}

/** O que chega de uma pessoa (a tela dela). */
export interface InboundStats {
  route: Route
  rttMs?: number
  kbps?: number
  fps?: number
  width?: number
  height?: number
  /** perda de pacotes de vídeo no intervalo, em % */
  lossPct?: number
  jitterMs?: number
  /** travadas novas no intervalo */
  freezes: number
  codec?: string
}

/** O que sai para uma pessoa (a minha tela). */
export interface OutboundStats {
  route: Route
  rttMs?: number
  kbps?: number
  fps?: number
  width?: number
  height?: number
  /** perda que o outro lado relatou (RTCP), em % */
  lossPct?: number
  /** por que o navegador está segurando a qualidade */
  limitation: Limitation
  /** banda que o navegador estima ter até essa pessoa */
  availableKbps?: number
  codec?: string
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function rowsOf(report: Iterable<StatRow> | Map<string, StatRow>): StatRow[] {
  return report instanceof Map ? [...report.values()] : [...report]
}

/** Par de candidatos em uso: rota (direto ou relay), atraso e banda estimada. */
export function readPair(rows: StatRow[]): { route: Route; rttMs?: number; availableKbps?: number } {
  const byId = new Map(rows.map((r) => [r.id, r]))
  let pairId: string | undefined
  for (const r of rows) if (r.type === 'transport' && typeof r.selectedCandidatePairId === 'string') pairId = r.selectedCandidatePairId
  if (!pairId) for (const r of rows) if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pairId = r.id
  const pair = pairId ? byId.get(pairId) : undefined
  if (!pair) return { route: 'conectando' }
  const local = byId.get(pair.localCandidateId as string)
  const remote = byId.get(pair.remoteCandidateId as string)
  const route: Route = local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : 'direto'
  const rtt = num(pair.currentRoundTripTime)
  const avail = num(pair.availableOutgoingBitrate)
  return {
    route,
    rttMs: rtt !== undefined ? Math.round(rtt * 1000) : undefined,
    availableKbps: avail !== undefined ? Math.round(avail / 1000) : undefined
  }
}

function codecOf(rows: StatRow[], codecId: unknown): string | undefined {
  if (typeof codecId !== 'string') return undefined
  const c = rows.find((r) => r.id === codecId)
  const mime = typeof c?.mimeType === 'string' ? c.mimeType : undefined
  return mime?.replace(/^video\//i, '')
}

/**
 * Lê o que está chegando e o que está saindo numa conexão.
 * `videoIn`/`videoOut`: ids das trilhas a considerar (a tela, não a câmera); sem eles, pega o maior fluxo de vídeo.
 */
export function readStats(
  report: Iterable<StatRow> | Map<string, StatRow>,
  prev: Counters | undefined,
  now: number,
  opts: { inTrack?: (r: StatRow) => boolean; outTrack?: (r: StatRow) => boolean } = {}
): { inbound?: InboundStats; outbound?: OutboundStats; counters: Counters } {
  const rows = rowsOf(report)
  const pair = readPair(rows)

  const ins = rows.filter((r) => r.type === 'inbound-rtp' && r.kind === 'video' && (!opts.inTrack || opts.inTrack(r)))
  const outs = rows.filter((r) => r.type === 'outbound-rtp' && r.kind === 'video' && (!opts.outTrack || opts.outTrack(r)))
  const biggest = (list: StatRow[], key: string) => list.slice().sort((a, b) => (num(b[key]) ?? 0) - (num(a[key]) ?? 0))[0]
  const vin = biggest(ins, 'bytesReceived')
  const vout = biggest(outs, 'bytesSent')

  const counters: Counters = {
    at: now,
    inBytes: num(vin?.bytesReceived) ?? 0,
    inPackets: num(vin?.packetsReceived) ?? 0,
    inLost: num(vin?.packetsLost) ?? 0,
    inFrames: num(vin?.framesDecoded) ?? 0,
    freezes: num(vin?.freezeCount) ?? 0,
    outBytes: num(vout?.bytesSent) ?? 0
  }
  const dt = prev ? (now - prev.at) / 1000 : 0
  const fresh = !!prev && dt > 0.2

  let inbound: InboundStats | undefined
  if (vin) {
    const dBytes = fresh ? counters.inBytes - prev.inBytes : 0
    const dPk = fresh ? counters.inPackets - prev.inPackets : 0
    const dLost = fresh ? Math.max(0, counters.inLost - prev.inLost) : 0
    const fpsCounted = fresh && counters.inFrames >= prev.inFrames ? (counters.inFrames - prev.inFrames) / dt : undefined
    const jitter = num(vin.jitter)
    inbound = {
      route: pair.route,
      rttMs: pair.rttMs,
      kbps: fresh && dBytes >= 0 ? Math.round((dBytes * 8) / dt / 1000) : undefined,
      fps: round1(num(vin.framesPerSecond) ?? fpsCounted),
      width: num(vin.frameWidth),
      height: num(vin.frameHeight),
      lossPct: fresh && dPk + dLost > 0 ? round1((dLost / (dPk + dLost)) * 100) : fresh ? 0 : undefined,
      jitterMs: jitter !== undefined ? Math.round(jitter * 1000) : undefined,
      freezes: fresh ? Math.max(0, counters.freezes - prev.freezes) : 0,
      codec: codecOf(rows, vin.codecId)
    }
  }

  let outbound: OutboundStats | undefined
  if (vout) {
    const dBytes = fresh ? counters.outBytes - prev.outBytes : 0
    const remoteIn = rows.find((r) => r.type === 'remote-inbound-rtp' && r.localId === vout.id)
    const frac = num(remoteIn?.fractionLost)
    const lim = vout.qualityLimitationReason
    outbound = {
      route: pair.route,
      rttMs: pair.rttMs,
      kbps: fresh && dBytes >= 0 ? Math.round((dBytes * 8) / dt / 1000) : undefined,
      fps: round1(num(vout.framesPerSecond)),
      width: num(vout.frameWidth),
      height: num(vout.frameHeight),
      lossPct: frac !== undefined ? round1(frac * 100) : undefined,
      limitation: lim === 'cpu' || lim === 'bandwidth' || lim === 'other' ? lim : 'none',
      availableKbps: pair.availableKbps,
      codec: codecOf(rows, vout.codecId)
    }
  }
  return { inbound, outbound, counters }
}

function round1(v: number | undefined): number | undefined {
  return v === undefined ? undefined : Math.round(v * 10) / 10
}

// ---------- veredito em português ----------

export type Health = 'bom' | 'atencao' | 'ruim'

/** Resumo que quem compartilha publica para os outros (estado da sala). */
export interface SendSummary {
  lim: Limitation
  fps?: number
  h?: number
  /** nível atual do automático, ex.: "1080p 60" (ausente = preset fixo) */
  lvl?: string
}

export interface Verdict {
  health: Health
  /** frase curta: o que está acontecendo */
  title: string
  /** o que fazer */
  advice: string
}

/** Junta o que eu recebo com o que quem envia relatou e diz, em português, o que está acontecendo. */
export function assess(name: string, inbound: InboundStats | undefined, recent: InboundStats[], send?: SendSummary): Verdict {
  if (!inbound) return { health: 'atencao', title: 'Esperando a imagem chegar', advice: 'Se demorar mais de 10 segundos, peça para compartilhar de novo.' }
  const loss = avg(recent.map((r) => r.lossPct))
  const freezes = recent.reduce((a, r) => a + r.freezes, 0)
  const rtts = recent.map((r) => r.rttMs).filter((v): v is number => v !== undefined)
  const swing = rtts.length > 2 ? Math.max(...rtts) - Math.min(...rtts) : 0

  if (send?.lim === 'cpu')
    return {
      health: 'ruim',
      title: `O PC de ${name} não está dando conta`,
      advice: 'Ele está rodando o jogo e codificando o vídeo ao mesmo tempo. Peça para baixar a qualidade ou fechar programas pesados.'
    }
  if (loss !== undefined && loss >= 5)
    return {
      health: 'ruim',
      title: `Muitos pacotes se perdendo (${fmtPct(loss)})`,
      advice: `A internet entre vocês está instável. Cabo de rede no lugar do Wi-Fi costuma resolver, dos dois lados.`
    }
  if (send?.lim === 'bandwidth')
    return {
      health: 'atencao',
      title: `O upload de ${name} está no limite`,
      advice: 'A imagem se ajusta à internet dele. Se tiver download rodando, pausar ajuda; senão, uma qualidade menor fica mais estável.'
    }
  if (freezes >= 3)
    return { health: 'atencao', title: `${freezes} travadas no último minuto`, advice: 'Costuma ser Wi-Fi oscilando. Se continuar, tente o cabo ou uma qualidade menor.' }
  if (loss !== undefined && loss >= 1.5)
    return { health: 'atencao', title: `Um pouco de perda (${fmtPct(loss)})`, advice: 'A imagem pode piscar ou borrar de vez em quando. Cabo de rede ajuda.' }
  if (swing >= 80)
    return { health: 'atencao', title: 'O atraso está oscilando', advice: 'A rota está instável, típico de Wi-Fi ou 4G. O vídeo pode dar umas engasgadas.' }
  if (inbound.route === 'relay')
    return { health: 'bom', title: 'Tudo certo, pelo relay', advice: 'A conexão direta não deu, então o vídeo passa pelo servidor da Cloudflare. Funciona, com um pouco mais de atraso.' }
  return { health: 'bom', title: 'Sinal limpo', advice: 'Nada a fazer: a imagem está chegando inteira.' }
}

function avg(list: (number | undefined)[]): number | undefined {
  const v = list.filter((x): x is number => x !== undefined)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined
}

export function fmtPct(v: number): string {
  return `${v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)}%`
}

export function fmtMbps(kbps: number | undefined): string {
  if (kbps === undefined) return 'sem dados'
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1).replace('.', ',')} Mbps` : `${kbps} kbps`
}

export function fmtRes(w?: number, h?: number, fps?: number): string {
  if (!h) return 'sem imagem'
  return `${w ?? '?'}×${h}${fps !== undefined ? ` · ${Math.round(fps)} fps` : ''}`
}
