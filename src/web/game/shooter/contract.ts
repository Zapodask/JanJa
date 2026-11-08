/**
 * CONTRATO do Tiro na Sala no navegador (escrito pelo planejador).
 *
 * - REDE (agente "rede", pasta net/): canal de jogo no PeerManager, repasse pelo servidor,
 *   host rodando a simulação (Web Worker), predição e interpolação. Entrega um `ShooterSession`.
 * - CENA (agente "cena", pasta scene/ + HUD + sala): desenha `ShooterFrame` em Pixi, captura
 *   teclado/mouse/controle/toque e devolve `InputState`. Não fala com a rede.
 *
 * Coordenadas sempre em pixels do mundo (ver src/shared/games/shooter/types.ts).
 */
import type { PickupKind, ProjectileKind, ScoreLine, ShooterView, SimEvent, SimPhase, WeaponId } from '../../../shared/games/shooter/types'

// ---------------- o que a CENA desenha ----------------

export interface RenderPlayer {
  slot: number
  id: string
  name: string
  bot: boolean
  x: number
  y: number
  /** mira (vetor unitário) */
  ax: number
  ay: number
  hp: number
  alive: boolean
  weapon: WeaponId
  /** Infinity na pistola */
  ammo: number
  grenades: number
  dashing: boolean
  invulnerable: boolean
  /** é você (posição vem da predição local) */
  me: boolean
  kills: number
  deaths: number
}

export interface RenderProjectile {
  id: number
  owner: number
  kind: ProjectileKind
  x: number
  y: number
  vx: number
  vy: number
  /** previsto localmente (seu tiro antes da confirmação do host) */
  predicted: boolean
}

export interface RenderPickup {
  id: number
  kind: PickupKind
  x: number
  y: number
  available: boolean
  /** 0..1 até voltar (para o anel), 1 = disponível */
  ready: number
}

export type NetStatus = 'conectando' | 'p2p' | 'relay' | 'trocando-host' | 'host' | 'offline'

/** Um quadro pronto para desenhar. A REDE recalcula a cada requestAnimationFrame. */
export interface ShooterFrame {
  mapId: ShooterView['options']['mapId']
  phase: SimPhase
  /** ms até acabar o aquecimento (aquecendo) ou a partida (jogando) */
  timeLeftMs: number
  killLimit: number
  /** meu slot, null = espectador */
  me: number | null
  players: RenderPlayer[]
  projectiles: RenderProjectile[]
  pickups: RenderPickup[]
  /** ordenado como o ranking */
  scores: ScoreLine[]
  net: NetStatus
  /** ida e volta até o host (ms); 0 quando você é o host */
  pingMs: number
}

/** Eventos já sem repetição, na ordem. `local` = previsto (seu tiro), o host não manda de novo. */
export type FrameEvent = SimEvent & { local?: boolean }

// ---------------- o que a CENA devolve ----------------

/** Estado dos controles agora. A CENA converte o mouse da tela para o mundo antes. */
export interface InputState {
  mx: number
  my: number
  ax: number
  ay: number
  /** BTN_FIRE | BTN_DASH | BTN_GRENADE */
  buttons: number
}

// ---------------- sessão (REDE produz, a SALA usa) ----------------

export interface ShooterSession {
  /** quadro mais recente (lido pela cena no próprio ticker do Pixi, sem re-render do React) */
  frame(): ShooterFrame | null
  /** chamado pela cena a cada quadro; a REDE amostra no ritmo do tick */
  setInput(input: InputState): void
  /** eventos para efeitos e sons; devolve o cancelamento */
  onEvents(cb: (events: FrameEvent[]) => void): () => void
  dispose(): void
}

/** O que a SALA passa para criar a sessão (Room.tsx monta isto com useRoom). */
export interface ShooterSessionDeps {
  view: ShooterView
  /** PeerManager atual (canal "game"); pode faltar logo ao entrar */
  manager: import('../../rtc/PeerManager').PeerManager | undefined
  /**
   * repasse pelo servidor. `to` = playerId ou '*'. (O canal P2P não sabe playerId: ao abrir, cada
   * lado manda um "olá" com o próprio playerId e a REDE monta o mapa peerId ↔ playerId.)
   */
  relay(to: string, data: string): void
  onRelay(cb: (from: string, data: string) => void): () => void
  /** ação no coordenador (score/result) */
  act(action: import('../../../shared/games/shooter/types').ShooterAction): void
}

// ---------------- CENA ----------------

export interface ShooterSceneProps {
  session: ShooterSession
  /** cor de cada jogador por id (humano: a mesma da sala; robô: escolhida pela cena) */
  colors: Record<string, string>
  reducedMotion: boolean
  /** sons pedidos pela cena a partir dos eventos (a SALA toca com o áudio do jogo) */
  onSfx?: (name: string, opts?: { volume?: number; pan?: number }) => void
  /** (adicionado pela CENA) false = miniatura/destaque: a cena solta teclado, mouse e toque. Padrão true. */
  inputEnabled?: boolean
}

/** (adicionado pela CENA) estado dos joysticks virtuais, em px CSS relativos ao palco; a própria cena desenha. */
export interface TouchUiState {
  move: { active: boolean; cx: number; cy: number; x: number; y: number }
  aim: { active: boolean; cx: number; cy: number; x: number; y: number; fire: boolean }
}
