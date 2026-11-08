/**
 * CONTRATO do diagnóstico de conexão (painel "Sinal") e do diário de eventos.
 * Escrito no planejamento; a lógica (PeerManager/useRoom) produz estes dados e a interface (SignalPanel) só lê.
 */
import type { InboundStats, OutboundStats } from './stats'

/** Tipo de evento do diário. Cada um tem ícone e cor próprios no painel e no console. */
export type DiagKind =
  | 'up' //        qualidade subiu (automático) / imagem recebida melhorou
  | 'down' //      qualidade desceu
  | 'perda' //     perda de pacotes acima de 3%
  | 'travada' //   imagem travou (freezeCount subiu)
  | 'cpu' //       o PC de quem envia está no limite
  | 'banda' //     upload no limite
  | 'relay' //     conexão passou a usar o relay (TURN)
  | 'direto' //    conexão direta estabelecida
  | 'tela' //      alguém começou/parou de compartilhar
  | 'info' //      qualquer outra coisa

export interface DiagEvent {
  id: number
  /** Date.now() */
  at: number
  kind: DiagKind
  /** nome da pessoa envolvida, se houver */
  who?: string
  /** frase curta em português, ex.: "A imagem de Pedro subiu para 1080p 60" */
  text: string
}

/** Histórico de recebimento de UMA pessoa (a tela dela), para o painel. */
export interface PeerDiag {
  /** leitura mais recente (undefined enquanto não chega vídeo) */
  inbound?: InboundStats
  /** últimas ~30 leituras (≈ 60 s, uma a cada 2 s), mais antiga primeiro */
  history: InboundStats[]
}

/** O que eu estou enviando, quando compartilho a tela. */
export interface SendDiag {
  /** 'auto' = modo automático; 'fixo' = preset escolhido */
  mode: 'auto' | 'fixo'
  /** nível atual do automático, ex.: "1080p 60"; ou o nome curto do preset fixo */
  levelLabel: string
  viewers: Array<{
    id: string
    name: string
    out?: OutboundStats
    /** últimas ~30 leituras, mais antiga primeiro */
    history: OutboundStats[]
  }>
}

/** Quantos eventos o diário guarda. */
export const LOG_SIZE = 60
/** Quantas leituras o histórico guarda (2 s cada). */
export const HISTORY_SIZE = 30
