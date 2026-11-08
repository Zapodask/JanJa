import { z } from 'zod'
import { ClientIdSchema, GameClientMessageSchemas, GameServerMessageSchemas } from './games/protocol'

/**
 * Protocolo de sinalização do JanJa. Cada sala é um Durable Object na Cloudflare que só
 * apresenta os participantes e repassa `signal` entre eles, sem ler o SDP. A mídia é P2P.
 */

export const MAX_MESSAGE_BYTES = 64 * 1024
/**
 * Teto de segurança da sala (não aparece na interface). Quem limita de verdade é cada canal,
 * porque a voz é P2P dentro do canal.
 */
export const MAX_PEERS = 100
export const MAX_NAME_LENGTH = 32
export const ROOM_ID_RE = /^[A-Za-z0-9_-]{16,32}$/

// ---------- canais ----------
/** limite de canal `0` = sem limite */
export const UNLIMITED = 0
/** opções de limite que o dono escolhe ao criar ou editar um canal */
export const CHANNEL_LIMITS = [2, 3, 4, 5, 8, 10, 15, 20, UNLIMITED] as const
/** limite sugerido para canal novo: acima disso a malha P2P fica pesada */
export const HEAVY_CHANNEL = 8
export const MAX_CHANNEL_LIMIT = 99
export const MAX_CHANNELS = 20
export const MAX_CHANNEL_NAME = 24

const ChannelLimitSchema = z.number().int().min(0).max(MAX_CHANNEL_LIMIT)

export const ChannelSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().trim().min(1).max(MAX_CHANNEL_NAME),
  /** máximo de pessoas no canal; ausente ou 0 = sem limite */
  limit: ChannelLimitSchema.optional()
})
export type Channel = z.infer<typeof ChannelSchema>

export const MAX_ROOM_NAME = 32
/** nome de sala antiga, criada antes de as salas terem nome */
export const DEFAULT_ROOM_NAME = 'Sala'
const RoomNameSchema = z.string().trim().min(1).max(MAX_ROOM_NAME)

export const RoomSettingsSchema = z.object({
  /** nome da sala ("servidor"), escolhido por quem criou */
  name: z.string(),
  channels: z.array(ChannelSchema).min(1).max(MAX_CHANNELS)
})
export type RoomSettings = z.infer<typeof RoomSettingsSchema>

export const DEFAULT_CHANNELS: Channel[] = [{ id: 'geral', name: 'Geral' }]

/** o canal tem vaga para mais uma pessoa? */
export const channelHasRoom = (ch: Channel, count: number): boolean => !ch.limit || count < ch.limit

// ---------- chat do canal ----------
export const MAX_CHAT_TEXT = 500
/** mensagens guardadas por canal (quem entra vê as últimas) */
export const CHAT_HISTORY = 50

export const ChatMessageSchema = z.object({
  id: z.string(),
  /** peerId de quem mandou (muda a cada entrada; o nome é o que aparece) */
  from: z.string(),
  name: z.string(),
  text: z.string(),
  at: z.number()
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

const ChannelNameSchema = z.string().trim().min(1).max(MAX_CHANNEL_NAME)
const ChannelIdSchema = z.string().min(1).max(32)

export const IceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional()
})
export type IceServer = z.infer<typeof IceServerSchema>

export const PeerStateSchema = z.object({
  sharing: z.boolean(),
  micMuted: z.boolean(),
  /** id do MediaStream da tela, para o receptor separar o áudio da tela do microfone */
  screenStreamId: z.string().max(128).optional(),
  /** id do MediaStream da webcam (presente = câmera ligada) */
  camStreamId: z.string().max(128).optional()
})
export type PeerState = z.infer<typeof PeerStateSchema>

export const SignalPayloadSchema = z.object({
  description: z
    .object({ type: z.enum(['offer', 'answer', 'pranswer', 'rollback']), sdp: z.string().optional() })
    .optional(),
  candidate: z
    .object({
      candidate: z.string().optional(),
      sdpMid: z.string().nullable().optional(),
      sdpMLineIndex: z.number().nullable().optional(),
      usernameFragment: z.string().nullable().optional()
    })
    .nullable()
    .optional()
})
export type SignalPayload = z.infer<typeof SignalPayloadSchema>

// ---------- cliente -> servidor ----------
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('join'),
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
    /** chave de quem criou a sala; dá o papel de host (aprova entradas) */
    hostKey: z.string().max(128).optional(),
    /** identidade estável nesta sala (jogos): recupera a cadeira ao reconectar */
    clientId: ClientIdSchema.optional(),
    /** canal onde estava antes de reconectar (se ainda existir, volta para ele) */
    channelId: ChannelIdSchema.optional()
  }),
  z.object({ type: z.literal('signal'), to: z.string().min(1).max(64), payload: SignalPayloadSchema }),
  z.object({ type: z.literal('state'), state: PeerStateSchema }),
  z.object({ type: z.literal('join-response'), requestId: z.string().max(64), approved: z.boolean() }),
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('channel-join'), channelId: ChannelIdSchema }),
  /** mensagem no chat do seu canal */
  z.object({ type: z.literal('chat-send'), text: z.string().trim().min(1).max(MAX_CHAT_TEXT) }),
  // só o host:
  z.object({ type: z.literal('channel-create'), name: ChannelNameSchema, limit: ChannelLimitSchema }),
  /** muda nome e limite (baixar o limite não tira ninguém do canal) */
  z.object({ type: z.literal('channel-edit'), channelId: ChannelIdSchema, name: ChannelNameSchema, limit: ChannelLimitSchema }),
  z.object({ type: z.literal('channel-delete'), channelId: ChannelIdSchema }),
  z.object({ type: z.literal('room-rename'), name: RoomNameSchema }),
  ...GameClientMessageSchemas
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>

// ---------- servidor -> cliente ----------
export const PeerInfoSchema = z.object({
  peerId: z.string(),
  name: z.string(),
  state: PeerStateSchema,
  isHost: z.boolean(),
  channelId: z.string()
})
export type PeerInfo = z.infer<typeof PeerInfoSchema>

export const ErrorCodeSchema = z.enum([
  'room-not-found',
  'room-full',
  'denied',
  'host-absent',
  'bad-message',
  'not-joined',
  'rate-limited',
  'unknown-peer',
  'not-host',
  'unknown-channel',
  'channel-limit',
  'channel-full',
  'chat-flood'
])
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    peerId: z.string(),
    isHost: z.boolean(),
    peers: z.array(PeerInfoSchema),
    iceServers: z.array(IceServerSchema),
    /** canal onde você entrou */
    channelId: z.string(),
    settings: RoomSettingsSchema
  }),
  z.object({ type: z.literal('room-settings'), settings: RoomSettingsSchema }),
  /** alguém (inclusive você) trocou de canal */
  z.object({ type: z.literal('peer-moved'), peerId: z.string(), channelId: z.string() }),
  /** mensagem nova no chat do seu canal */
  z.object({ type: z.literal('chat'), channelId: z.string(), message: ChatMessageSchema }),
  /** últimas mensagens do canal (ao entrar na sala ou trocar de canal) */
  z.object({ type: z.literal('chat-history'), channelId: z.string(), messages: z.array(ChatMessageSchema) }),
  z.object({ type: z.literal('waiting-approval') }),
  z.object({ type: z.literal('join-request'), requestId: z.string(), name: z.string() }),
  z.object({ type: z.literal('join-request-cancelled'), requestId: z.string() }),
  z.object({ type: z.literal('peer-joined'), peer: PeerInfoSchema }),
  z.object({ type: z.literal('peer-left'), peerId: z.string() }),
  z.object({ type: z.literal('signal'), from: z.string(), payload: SignalPayloadSchema }),
  z.object({ type: z.literal('state'), from: z.string(), state: PeerStateSchema }),
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('error'), code: ErrorCodeSchema, message: z.string() }),
  ...GameServerMessageSchemas
])
export type ServerMessage = z.infer<typeof ServerMessageSchema>

export const INITIAL_STATE: PeerState = { sharing: false, micMuted: false }

// ---------- API HTTP ----------
export const CreateRoomRequestSchema = z.object({
  requireApproval: z.boolean(),
  name: RoomNameSchema.optional()
})
export const CreateRoomResponseSchema = z.object({ roomId: z.string(), hostKey: z.string() })
export type CreateRoomResponse = z.infer<typeof CreateRoomResponseSchema>

// ---------- links ----------
export function roomUrl(origin: string, roomId: string): string {
  return `${origin.replace(/\/$/, '')}/r/${roomId}`
}

/** Aceita o link inteiro da sala ou só o código. */
export function parseRoomInput(input: string): string {
  const text = input.trim()
  const fromUrl = /\/r\/([A-Za-z0-9_-]+)/.exec(text)?.[1]
  const id = fromUrl ?? text
  if (!ROOM_ID_RE.test(id)) throw new Error('Link ou código de sala inválido.')
  return id
}

export function wsUrlFor(origin: string, roomId: string): string {
  const url = new URL(`/ws/${roomId}`, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
