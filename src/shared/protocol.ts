import { z } from 'zod'
import { ClientIdSchema, GameClientMessageSchemas, GameServerMessageSchemas } from './games/protocol'

/**
 * Protocolo de sinalização do JanJa. Cada sala é um Durable Object na Cloudflare que só
 * apresenta os participantes e repassa `signal` entre eles, sem ler o SDP. A mídia é P2P.
 */

export const MAX_MESSAGE_BYTES = 64 * 1024
export const MAX_PEERS = 5
export const MAX_NAME_LENGTH = 32
export const ROOM_ID_RE = /^[A-Za-z0-9_-]{16,32}$/

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
    clientId: ClientIdSchema.optional()
  }),
  z.object({ type: z.literal('signal'), to: z.string().min(1).max(64), payload: SignalPayloadSchema }),
  z.object({ type: z.literal('state'), state: PeerStateSchema }),
  z.object({ type: z.literal('join-response'), requestId: z.string().max(64), approved: z.boolean() }),
  z.object({ type: z.literal('ping') }),
  ...GameClientMessageSchemas
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>

// ---------- servidor -> cliente ----------
export const PeerInfoSchema = z.object({
  peerId: z.string(),
  name: z.string(),
  state: PeerStateSchema,
  isHost: z.boolean()
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
  'unknown-peer'
])
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    peerId: z.string(),
    isHost: z.boolean(),
    peers: z.array(PeerInfoSchema),
    iceServers: z.array(IceServerSchema)
  }),
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
export const CreateRoomRequestSchema = z.object({ requireApproval: z.boolean() })
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
