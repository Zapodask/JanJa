/**
 * CONTRATO do Tiro na Sala (escrito pelo planejador; os agentes implementam, não mudam sem combinar).
 *
 * Duas camadas:
 *  1. COORDENADOR (Durable Object, `GameDefinition` normal): lobby, quem é o host da simulação,
 *     placar parcial e resultado final. Não roda a simulação.
 *  2. SIMULAÇÃO (navegador do host): tick fixo de TICK_HZ, autoritativa. Os clientes mandam
 *     entradas e recebem snapshots por DataChannel P2P (ou pelo repasse `game-relay` do servidor).
 *
 * Unidades: posição em pixels do mundo (tile = 16 px), velocidade em px/s, tempo em ticks.
 * Mira e movimento são vetores (sem ângulos na rede). Proibido `Date.now()`/`Math.random()` aqui:
 * a aleatoriedade sai do RNG guardado no estado (`SimState.rng`, mulberry32).
 */
import type { PlayerRef } from '../types'

// =====================================================================================
// Constantes de tempo e mundo
// =====================================================================================

export const TICK_HZ = 40
export const TICK_MS = 25
export const DT = 1 / TICK_HZ
/** o host manda snapshot a cada SNAPSHOT_EVERY ticks (20 Hz) */
export const SNAPSHOT_EVERY = 2
/** os outros jogadores são desenhados este tanto no passado (interpolação) */
export const INTERP_DELAY_MS = 110
/** quantas entradas antigas cada pacote de entrada repete (cobre perda sem retransmissão) */
export const INPUT_REDUNDANCY = 3
/** compensação máxima de atraso para projéteis de quem atirou (ms) */
export const MAX_LAG_COMP_MS = 150

export const TILE = 16
export const PLAYER_RADIUS = 5
export const PLAYER_SPEED = 110
export const MAX_HP = 100
export const RESPAWN_TICKS = 3 * TICK_HZ
export const SPAWN_INVULN_TICKS = 1 * TICK_HZ
export const DASH_TICKS = 6 // 0,15 s
export const DASH_SPEED = 380
export const DASH_COOLDOWN_TICKS = 2 * TICK_HZ
/** água deixa mais lento */
export const WATER_SPEED_MUL = 0.55
/** aquecimento antes de contar abates */
export const WARMUP_TICKS = 5 * TICK_HZ

/** slots: humanos 0..7, robôs 8..11 */
export const MAX_HUMANS = 8
export const MAX_BOTS = 4
export const BOT_SLOT_BASE = 8

// =====================================================================================
// Armas
// =====================================================================================

export type WeaponId = 'pistola' | 'escopeta' | 'sub' | 'rifle' | 'rolha'
export type ProjectileKind = 'bala' | 'bago' | 'rifle' | 'rolha' | 'granada'

export interface WeaponSpec {
  id: WeaponId
  name: string
  /** ticks entre tiros */
  cooldownTicks: number
  /** munição ao pegar; Infinity = pistola */
  ammo: number
  projectile: ProjectileKind
  /** projéteis por tiro */
  pellets: number
  /** espalhamento total do leque (bagos) ou aleatório (sub), em radianos */
  spread: number
  speed: number
  damage: number
  /** vida do projétil em ticks */
  lifeTicks: number
  /** raio da explosão (rolha); 0 = não explode */
  blastRadius: number
  /** tremida de câmera sugerida (px) — só visual */
  shake: number
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistola: { id: 'pistola', name: 'Pistola', cooldownTicks: 13, ammo: Infinity, projectile: 'bala', pellets: 1, spread: 0.03, speed: 360, damage: 20, lifeTicks: 48, blastRadius: 0, shake: 1 },
  escopeta: { id: 'escopeta', name: 'Escopeta', cooldownTicks: 32, ammo: 8, projectile: 'bago', pellets: 6, spread: 0.48, speed: 330, damage: 12, lifeTicks: 14, blastRadius: 0, shake: 3 },
  sub: { id: 'sub', name: 'Submetralhadora', cooldownTicks: 3, ammo: 60, projectile: 'bala', pellets: 1, spread: 0.2, speed: 400, damage: 8, lifeTicks: 40, blastRadius: 0, shake: 1 },
  rifle: { id: 'rifle', name: 'Rifle', cooldownTicks: 40, ammo: 5, projectile: 'rifle', pellets: 1, spread: 0, speed: 900, damage: 70, lifeTicks: 40, blastRadius: 0, shake: 2 },
  rolha: { id: 'rolha', name: 'Bazuca de rolha', cooldownTicks: 44, ammo: 3, projectile: 'rolha', pellets: 1, spread: 0, speed: 260, damage: 80, lifeTicks: 80, blastRadius: 36, shake: 4 }
}

export const GRENADE = {
  maxCarry: 2,
  regenTicks: 8 * TICK_HZ,
  throwSpeed: 230,
  /** a velocidade multiplica por isto a cada tick */
  friction: 0.95,
  fuseTicks: 48, // 1,2 s
  blastRadius: 40,
  damage: 90
} as const

/** explosão: dano cai linearmente até este fator na borda; quem lançou toma metade */
export const BLAST_EDGE_FACTOR = 0.35
export const SELF_BLAST_FACTOR = 0.5
/** empurrão da explosão no centro (px/s), some na borda */
export const BLAST_KNOCKBACK = 260

export type PickupKind = WeaponId | 'vida'
export const HEAL_AMOUNT = 40
export const PICKUP_RESPAWN_TICKS: Record<PickupKind, number> = {
  pistola: 0,
  escopeta: 20 * TICK_HZ,
  sub: 20 * TICK_HZ,
  rifle: 20 * TICK_HZ,
  rolha: 35 * TICK_HZ,
  vida: 20 * TICK_HZ
}
export const PICKUP_RADIUS = 9

// =====================================================================================
// Mapas
// =====================================================================================

/** Como cada tile se comporta. A legenda de caracteres fica em maps/legend.ts (agente da simulação). */
export interface TileInfo {
  /** chave de arte para a cena desenhar (ex.: 'piso-madeira', 'parede', 'sofa', 'agua', 'grama') */
  art: string
  /** bloqueia quem anda */
  solid: boolean
  /** bloqueia tiro. Parede e móvel alto: solid + blocksShot. Mureta/mesa baixa: solid sem blocksShot (dá para atirar por cima). */
  blocksShot: boolean
  /** água: anda mais devagar */
  slow: boolean
  /** (adicionado) chave de arte do piso que aparece embaixo de móveis e objetos; ausente = o próprio tile é o piso */
  floor?: string
}

export interface MapDef {
  id: 'casa' | 'quintal'
  name: string
  /** em tiles */
  w: number
  h: number
  /** h linhas de w caracteres; cada caractere está na legenda */
  rows: readonly string[]
  /** centros em px do mundo */
  spawns: readonly { x: number; y: number }[]
  pickups: readonly { kind: PickupKind; x: number; y: number }[]
}

export type MapId = MapDef['id']

// =====================================================================================
// Opções e coordenador (Durable Object)
// =====================================================================================

export type MatchMinutes = 3 | 5 | 8
export type KillLimit = 10 | 20 | 30

export interface ShooterOptions {
  mapId: MapId
  minutes: MatchMinutes
  killLimit: KillLimit
  /** robôs controlados pelo host, 0..MAX_BOTS */
  bots: number
}

export const DEFAULT_SHOOTER_OPTIONS: ShooterOptions = { mapId: 'casa', minutes: 5, killLimit: 20, bots: 0 }
export const MATCH_MINUTES: readonly MatchMinutes[] = [3, 5, 8]
export const KILL_LIMITS: readonly KillLimit[] = [10, 20, 30]

/** placar de um jogador (humano ou robô) */
export interface ScoreLine {
  /** playerId (humano) ou `bot-1`..`bot-4` */
  id: string
  kills: number
  deaths: number
  damage: number
}

export interface ShooterPlayerView {
  /** playerId (humano) ou `bot-N` */
  id: string
  name: string
  slot: number
  bot: boolean
  /** conectado à sala agora (robô: sempre true) */
  present: boolean
}

export type ShooterPhase = 'jogando' | 'fim'

/** Visão do coordenador: igual para todos (nada é secreto num tiroteio). */
export interface ShooterView {
  you: { playerId: string; slot: number } | null
  options: ShooterOptions
  phase: ShooterPhase
  players: ShooterPlayerView[]
  /** playerId de quem roda a simulação agora */
  hostId: string
  /** cresce a cada troca de host; pacotes e ações de um epoch antigo são ignorados */
  epoch: number
  /** semente da simulação (o primeiro host usa; o próximo continua do snapshot) */
  seed: number
  /** ms epoch em que a partida foi criada no servidor */
  createdAt: number
  /** último placar informado pelo host (ou o final) */
  scores: ScoreLine[]
  /** ranking final, do 1º ao último (só em 'fim') */
  ranking: ScoreLine[] | null
}

/** Ações do coordenador (cliente → servidor via game-action). Só o host atual (e no epoch atual) manda. */
export type ShooterAction =
  /** placar parcial, a cada ~5 s */
  | { type: 'score'; epoch: number; scores: ScoreLine[] }
  /** fim da partida (tempo ou limite de abates); ranking já ordenado */
  | { type: 'result'; epoch: number; ranking: ScoreLine[] }

export type ShooterEvent =
  | { type: 'host'; hostId: string; epoch: number }
  | { type: 'joined'; id: string; name: string; slot: number }
  | { type: 'fim'; ranking: ScoreLine[] }

/**
 * Prazo de segurança do coordenador: se o host não mandar 'result', o servidor encerra com o último
 * placar em createdAt + (minutos * 60 + aquecimento + COORD_GRACE_S) s.
 */
export const COORD_GRACE_S = 30

// =====================================================================================
// Simulação (roda no host; o cliente usa movePlayer para prever o próprio boneco)
// =====================================================================================

export const BTN_FIRE = 1
export const BTN_DASH = 2
export const BTN_GRENADE = 4

/** Uma entrada por tick do cliente. */
export interface Input {
  /** sequência crescente por jogador (1, 2, 3...) */
  seq: number
  /** movimento, cada eixo em -1..1 (comprimento até 1) */
  mx: number
  my: number
  /** mira, vetor unitário (se 0,0 o sim mantém a anterior) */
  ax: number
  ay: number
  /** BTN_* seguradas */
  buttons: number
  /**
   * Preenchido SÓ pelo host antes do step (nunca vem do cliente): atraso de quem atirou, em ticks
   * (0..ceil(MAX_LAG_COMP_MS/TICK_MS)). O projétil novo já nasce avançado esse tanto.
   */
  lagTicks?: number
}

export const EMPTY_INPUT: Input = { seq: 0, mx: 0, my: 0, ax: 1, ay: 0, buttons: 0 }

export interface SimPlayer {
  slot: number
  id: string
  bot: boolean
  /** desconectado: congelado, invisível, não toma dano */
  away: boolean
  x: number
  y: number
  /** velocidade extra (empurrão de explosão), decai */
  kx: number
  ky: number
  ax: number
  ay: number
  hp: number
  alive: boolean
  /** tick em que renasce (se !alive) */
  respawnTick: number
  invulnUntil: number
  weapon: WeaponId
  ammo: number
  nextFireTick: number
  dashUntil: number
  dashReadyTick: number
  dashX: number
  dashY: number
  grenades: number
  grenadeRegenTick: number
  kills: number
  deaths: number
  damage: number
  /** abates seguidos sem morrer */
  streak: number
  /** última entrada aplicada (o snapshot devolve isto como ack) */
  lastSeq: number
  prevButtons: number
  /** (adicionado) última entrada aplicada, repetida quando o tick chega sem entrada nova */
  lastInput?: Input
  /** (adicionado) memória da IA dos robôs; serializável, só bots.ts mexe */
  ai?: BotMemory
}

/** (adicionado) memória de um robô, guardada no estado para ele continuar clonável e serializável */
export interface BotMemory {
  /** slot do alvo atual (-1 = nenhum) */
  target: number
  /** ticks seguidos mirando no alvo */
  aimTicks: number
  /** erro de mira atual, em radianos */
  err: number
  errTick: number
  /** último tick em que viu o alvo e onde */
  seenTick: number
  seenX: number
  seenY: number
  /** velocidade estimada do alvo (px/s) */
  tvx: number
  tvy: number
  /** quantos ticks o alvo está praticamente parado */
  still: number
  /** objetivo de caminhada (px) e tick em que foi escolhido */
  goalX: number
  goalY: number
  goalTick: number
  /** próximo ponto do caminho (px) e tick do último cálculo */
  wayX: number
  wayY: number
  pathTick: number
  strafe: 1 | -1
  strafeUntil: number
  hp: number
  hurtTick: number
  /** controle de travamento */
  chkTick: number
  chkX: number
  chkY: number
  stuck: number
  /** até este tick anda numa direção aleatória para se soltar */
  freeUntil: number
  freeX: number
  freeY: number
}

export interface SimProjectile {
  id: number
  owner: number
  kind: ProjectileKind
  /** arma que disparou (granada: 'pistola' ignorado; use kind) */
  weapon: WeaponId | 'granada'
  x: number
  y: number
  vx: number
  vy: number
  damage: number
  dieTick: number
}

export interface SimPickup {
  /** índice em MapDef.pickups */
  id: number
  kind: PickupKind
  x: number
  y: number
  /** 0 = disponível; senão, tick em que volta */
  backTick: number
}

export type SimPhase = 'aquecendo' | 'jogando' | 'fim'

export interface SimState {
  mapId: MapId
  tick: number
  phase: SimPhase
  /** tick em que acaba o aquecimento */
  warmupEndTick: number
  /** tick em que acaba a partida */
  endTick: number
  killLimit: number
  /** estado do mulberry32 */
  rng: number
  nextId: number
  players: SimPlayer[]
  projectiles: SimProjectile[]
  pickups: SimPickup[]
}

export type SimEvent =
  | { type: 'shot'; slot: number; weapon: WeaponId; x: number; y: number; ax: number; ay: number }
  | { type: 'grenade'; slot: number; x: number; y: number }
  | { type: 'hit'; victim: number; attacker: number; damage: number; x: number; y: number }
  | { type: 'kill'; victim: number; killer: number; weapon: WeaponId | 'granada'; streak: number }
  | { type: 'spawn'; slot: number; x: number; y: number }
  | { type: 'pickup'; slot: number; kind: PickupKind; pickupId: number }
  | { type: 'explode'; x: number; y: number; radius: number }
  /** projétil bateu na parede (faísca) */
  | { type: 'wall'; x: number; y: number }
  | { type: 'dash'; slot: number }
  | { type: 'phase'; phase: SimPhase }

/** Quem entra na simulação. */
export interface SimPlayerRef {
  slot: number
  id: string
  bot: boolean
}

/**
 * API da simulação (agente da simulação implementa em sim.ts; os outros só importam).
 * `step` MUTA o estado (é o laço quente do host). Para prever ou testar, clone antes com cloneState.
 */
export interface SimApi {
  createSim(players: SimPlayerRef[], opts: ShooterOptions, seed: number): SimState
  /** um tick. `inputs` = entrada deste tick por slot (falta = repete a última, robôs via botInput). */
  step(state: SimState, inputs: ReadonlyMap<number, Input>): SimEvent[]
  cloneState(state: SimState): SimState
  addPlayer(state: SimState, ref: SimPlayerRef): void
  setAway(state: SimState, slot: number, away: boolean): void
  /**
   * Movimento de um jogador por um tick (andar, dash, colisão com paredes, água, empurrão).
   * Usado dentro de step E pelo cliente na predição: precisa ser a mesma função.
   */
  movePlayer(map: MapDef, p: SimPlayer, input: Input, tick: number): void
  /** entrada de um robô para este tick (determinística com o RNG do estado) */
  botInput(state: SimState, slot: number): Input
  scores(state: SimState): ScoreLine[]
  /** ordenado: abates desc, mortes asc, dano desc */
  ranking(state: SimState): ScoreLine[]
}

export type { PlayerRef }
