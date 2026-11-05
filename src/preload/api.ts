import type { IceServer } from '../shared/protocol'

/** Contrato entre o renderer e o main, exposto em `window.janja` pelo preload. */

export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string
}

export type RoomMode = 'tunnel' | 'lan'

export interface CreateRoomOptions {
  mode: RoomMode
  requireApproval: boolean
  iceServers: IceServer[]
  /** porta fixa para o modo LAN (facilita liberar no firewall) */
  lanPort?: number
}

export interface RoomInfo {
  mode: RoomMode
  /** códigos para compartilhar com os amigos (1 no modo túnel; 1 por IP no modo LAN) */
  codes: { label: string; code: string }[]
  /** código que o próprio host usa para entrar (localhost + token de host) */
  hostCode: string
}

export interface JoinRequest {
  requestId: string
  name: string
}

export interface JanjaApi {
  platform: string
  listSources: () => Promise<CaptureSource[]>
  /** Escolhe a fonte que o próximo getDisplayMedia vai usar. */
  selectSource: (id: string, withAudio: boolean) => Promise<void>
  createRoom: (opts: CreateRoomOptions) => Promise<RoomInfo>
  closeRoom: () => Promise<void>
  onRoomStatus: (cb: (status: string) => void) => () => void
  onJoinRequest: (cb: (req: JoinRequest) => void) => () => void
  respondJoin: (requestId: string, approved: boolean) => void
  /** link de sala recebido por janja:// quando o app abriu */
  takePendingLink: () => Promise<string | null>
  /** link de sala recebido por janja:// com o app já aberto */
  onOpenLink: (cb: (code: string) => void) => () => void
}
