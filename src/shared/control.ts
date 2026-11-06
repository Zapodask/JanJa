import { z } from 'zod'

/**
 * Controle remoto. Contrato A: mensagens no DataChannel P2P "control" (página ↔ página).
 * Contrato B: mensagens no WebSocket local (página ↔ helper).
 * Tudo que chega de fora passa por estes schemas; o que não bate é descartado.
 */

export const CONTROL_CHANNEL_LABEL = 'control'
export const CONTROL_CHANNEL_ID = 7
export const MAX_CONTROL_BYTES = 512
export const HELPER_URL = 'ws://127.0.0.1:47800'
export const HELPER_DOWNLOAD_URL = 'https://github.com/pedrohhope/JanJa/releases/latest'
export const PANIC_SHORTCUT = 'Ctrl+Alt+Shift+P'

const unit = z.number().min(0).max(1) // rejeita NaN e Infinity
const notch = z.number().int().min(-10).max(10)
const button = z.union([z.literal(0), z.literal(1), z.literal(2)])
/** KeyboardEvent.code: só letras e dígitos, curto */
const keyCode = z.string().min(1).max(32).regex(/^[A-Za-z0-9]+$/)

export const InputMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('mm'), x: unit, y: unit }),
  z.object({ t: z.literal('md'), b: button }),
  z.object({ t: z.literal('mu'), b: button }),
  z.object({ t: z.literal('wh'), dx: notch, dy: notch }),
  z.object({ t: z.literal('kd'), code: keyCode }),
  z.object({ t: z.literal('ku'), code: keyCode })
])
export type InputMsg = z.infer<typeof InputMsgSchema>

export const DENY_REASONS = ['recusado', 'sem-helper', 'nao-e-tela-inteira', 'ocupado'] as const
export type DenyReason = (typeof DENY_REASONS)[number]
export type EndBy = 'controlador' | 'controlado' | 'panico'

export const ControlMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('req') }),
  z.object({ t: z.literal('grant') }),
  z.object({ t: z.literal('deny'), reason: z.enum(DENY_REASONS) }),
  z.object({ t: z.literal('end'), by: z.enum(['controlador', 'controlado', 'panico']) }),
  ...InputMsgSchema.options
])
export type ControlMsg = z.infer<typeof ControlMsgSchema>

export const INPUT_TYPES: ReadonlySet<string> = new Set(['mm', 'md', 'mu', 'wh', 'kd', 'ku'])
export const isInputMsg = (m: ControlMsg): m is InputMsg => INPUT_TYPES.has(m.t)

const encoder = new TextEncoder()

/** Texto cru do DataChannel para mensagem válida, ou null (grande demais, JSON ruim, fora de faixa). */
export function parseControl(raw: unknown): ControlMsg | null {
  if (typeof raw !== 'string') return null
  if (raw.length > MAX_CONTROL_BYTES || encoder.encode(raw).length > MAX_CONTROL_BYTES) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = ControlMsgSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

export const encodeControl = (msg: ControlMsg): string => JSON.stringify(msg)

// ---------------- contrato B: página <-> helper ----------------

export const MonitorSchema = z.object({
  id: z.number().int(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  primary: z.boolean()
})
export type Monitor = z.infer<typeof MonitorSchema>

export const HelperMsgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('need-pair') }),
  z.object({ type: z.literal('paired'), token: z.string().min(1).max(256) }),
  z.object({ type: z.literal('ready'), monitors: z.array(MonitorSchema).max(16), version: z.number() }),
  z.object({ type: z.literal('panic') }),
  z.object({ type: z.literal('error'), message: z.string().max(500) })
])
export type HelperMsg = z.infer<typeof HelperMsgSchema>

export type PageToHelper =
  | { type: 'hello'; token?: string; version: 1 }
  | { type: 'pair'; code: string }
  | { type: 'session'; active: boolean; monitor?: number; peerName?: string }
  | { type: 'input'; ev: InputMsg }

export function parseHelper(raw: unknown): HelperMsg | null {
  if (typeof raw !== 'string' || raw.length > 16 * 1024) return null
  try {
    const parsed = HelperMsgSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
