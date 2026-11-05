import { z } from 'zod'

/** Protocolo de sinalização do JanJa. O servidor só repassa `signal` entre peers, sem ler o SDP. */

export const MAX_MESSAGE_BYTES = 64 * 1024
export const MAX_PEERS = 5
export const MAX_NAME_LENGTH = 32

export const IceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional()
})
export type IceServer = z.infer<typeof IceServerSchema>

export const PeerStateSchema = z.object({
  sharing: z.boolean(),
  micMuted: z.boolean(),
  /** id do MediaStream da tela, para o receptor separar áudio da tela do microfone */
  screenStreamId: z.string().max(128).optional()
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
    token: z.string().min(1).max(128),
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH)
  }),
  z.object({ type: z.literal('signal'), to: z.string().min(1).max(64), payload: SignalPayloadSchema }),
  z.object({ type: z.literal('state'), state: PeerStateSchema }),
  z.object({ type: z.literal('ping') })
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>

// ---------- servidor -> cliente ----------
export const PeerInfoSchema = z.object({ peerId: z.string(), name: z.string(), state: PeerStateSchema })
export type PeerInfo = z.infer<typeof PeerInfoSchema>

export const ErrorCodeSchema = z.enum([
  'bad-token',
  'room-full',
  'denied',
  'bad-message',
  'not-joined',
  'rate-limited',
  'join-timeout',
  'unknown-peer'
])
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    peerId: z.string(),
    peers: z.array(PeerInfoSchema),
    iceServers: z.array(IceServerSchema)
  }),
  z.object({ type: z.literal('waiting-approval') }),
  z.object({ type: z.literal('peer-joined'), peer: PeerInfoSchema }),
  z.object({ type: z.literal('peer-left'), peerId: z.string() }),
  z.object({ type: z.literal('signal'), from: z.string(), payload: SignalPayloadSchema }),
  z.object({ type: z.literal('state'), from: z.string(), state: PeerStateSchema }),
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('error'), code: ErrorCodeSchema, message: z.string() })
])
export type ServerMessage = z.infer<typeof ServerMessageSchema>

export const INITIAL_STATE: PeerState = { sharing: false, micMuted: false }

/** Código da sala = URL do WebSocket + token no fragmento (#t=...), que não vai para logs de servidor. */
export function buildRoomCode(wsUrl: string, token: string): string {
  const url = new URL(wsUrl)
  url.hash = `t=${token}`
  return url.toString()
}

export function parseRoomCode(code: string): { wsUrl: string; token: string } {
  const trimmed = code.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Código de sala inválido.')
  }
  if (url.protocol === 'https:') url.protocol = 'wss:'
  if (url.protocol === 'http:') url.protocol = 'ws:'
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('Código de sala inválido.')
  const token = new URLSearchParams(url.hash.replace(/^#/, '')).get('t')
  if (!token) throw new Error('O código não tem o token da sala (#t=...).')
  url.hash = ''
  return { wsUrl: url.toString(), token }
}
