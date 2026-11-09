import { z } from 'zod'

/**
 * Mensagens de jogo no WebSocket da sala. O agente do servidor integra estes schemas nas
 * uniões ClientMessageSchema/ServerMessageSchema de ../protocol.ts (mesmo campo `type`).
 * `view` e `events` são específicos de cada jogo: aqui ficam como unknown e cada jogo
 * tipa do lado do cliente (ex.: PokerView/PokerEvent).
 */

export const GAME_IDS = ['poker', 'golf', 'chess', 'checkers', 'tycoon', 'truco', 'shooter', 'naval', 'mystery', 'pool', 'stop'] as const
export const GameIdSchema = z.enum(GAME_IDS)
export type GameId = z.infer<typeof GameIdSchema>

/** clientId: identidade estável da pessoa nesta sala (guardada no navegador). Recupera a cadeira ao reconectar. */
export const ClientIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)

/** maior pacote repassado (base64) */
export const RELAY_MAX_DATA = 6000
/** pacotes de repasse por segundo, por conexão; o excesso é descartado em silêncio */
export const RELAY_MAX_PER_SEC = 60

// ---------- cliente -> servidor ----------
export const GameClientMessageSchemas = [
  z.object({ type: z.literal('game-open'), gameId: GameIdSchema, options: z.unknown() }),
  z.object({ type: z.literal('game-sit'), seat: z.number().int().min(0).max(15).optional() }),
  z.object({ type: z.literal('game-stand') }),
  z.object({ type: z.literal('game-start') }),
  z.object({ type: z.literal('game-action'), seq: z.number().int().min(0), action: z.unknown() }),
  z.object({ type: z.literal('game-close') }),
  /**
   * Repasse de pacotes de jogo em tempo real (tiro) quando não há canal P2P com o host.
   * `to` = playerId de destino ou '*' (todos os sentados). `data` = pacote binário em base64.
   * O servidor só repassa (não guarda nem lê) e descarta o excesso acima de RELAY_MAX_PER_SEC.
   */
  z.object({ type: z.literal('game-relay'), to: z.string().min(1).max(64), data: z.string().max(RELAY_MAX_DATA) })
] as const

// ---------- servidor -> cliente ----------
export const LobbySeatSchema = z.object({
  seat: z.number().int(),
  playerId: z.string(),
  name: z.string(),
  /** conectado agora (a cadeira fica guardada se cair) */
  present: z.boolean(),
  /** é você (comparado pelo clientId do lado do servidor) */
  you: z.boolean()
})

export const GameLobbySchema = z.object({
  gameId: GameIdSchema,
  options: z.unknown(),
  /** quem abriu (nome) — pode iniciar/encerrar junto com o host da sala */
  openedBy: z.string(),
  canManage: z.boolean(),
  seats: z.array(LobbySeatSchema),
  maxPlayers: z.number().int(),
  minPlayers: z.number().int(),
  started: z.boolean()
})
export type GameLobby = z.infer<typeof GameLobbySchema>

export const GameErrorCodeSchema = z.enum([
  'sem-jogo',
  'jogo-aberto',
  'mesa-cheia',
  'nao-sentado',
  'ja-comecou',
  'sem-permissao',
  'opcoes-invalidas',
  'nao-e-sua-vez',
  'acao-invalida',
  'partida-encerrada',
  'jogadores-insuficientes',
  'seq-antigo'
])

export const GameServerMessageSchemas = [
  /** estado do lobby/cadeiras (todos recebem quando muda; null = nenhum jogo aberto) */
  z.object({ type: z.literal('game-lobby'), lobby: GameLobbySchema.nullable() }),
  /** visão personalizada do jogo em andamento; seq cresce a cada mudança */
  z.object({ type: z.literal('game-view'), seq: z.number().int(), view: z.unknown() }),
  /** eventos para animação/som, na ordem em que aconteceram */
  z.object({ type: z.literal('game-events'), seq: z.number().int(), events: z.array(z.unknown()) }),
  z.object({ type: z.literal('game-error'), code: GameErrorCodeSchema, message: z.string() }),
  /** pacote repassado; `from` = playerId de quem mandou (o servidor preenche, nunca confia no cliente) */
  z.object({ type: z.literal('game-relay'), from: z.string(), data: z.string() })
] as const
