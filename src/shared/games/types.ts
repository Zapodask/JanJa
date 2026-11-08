/**
 * Contrato genérico de jogo da sala (plataforma de "Activities" do JanJa).
 * O servidor (GameHost) só conhece isto; cada jogo implementa um GameDefinition.
 * Regras puras: sem rede, sem DOM, sem relógio nem aleatoriedade próprios
 * (tempo e sorteio chegam por GameCtx), então o mesmo código roda no Worker e nos testes.
 */

/** Fonte de aleatoriedade. Servidor: crypto.getRandomValues. Testes: semente fixa (seededRng). */
export interface Rng {
  /** inteiro uniforme em [0, max) */
  int(max: number): number
}

export interface GameCtx {
  /** agora, em ms (epoch) */
  now: number
  rng: Rng
}

/** Quem está sentado. `playerId` é público e estável durante a partida (não é o peerId). */
export interface PlayerRef {
  playerId: string
  name: string
}

export interface GameError {
  error: GameErrorCode
  message: string
}

export type GameErrorCode = 'nao-e-sua-vez' | 'acao-invalida' | 'partida-encerrada' | 'jogadores-insuficientes'

export const isGameError = (x: unknown): x is GameError =>
  typeof x === 'object' && x !== null && 'error' in x && typeof (x as GameError).error === 'string'

/** Resultado de toda transição: estado novo + eventos para animação/sons (vão para todos). */
export interface Step<State, Event> {
  state: State
  events: Event[]
}

export interface GameDefinition<State, Options, Action, View, Event> {
  id: string
  name: string
  minPlayers: number
  maxPlayers: number
  /**
   * Todos jogam ao mesmo tempo (ex.: golfe). O servidor aceita ações com `seq` antigo e o jogo
   * valida sozinho se a ação ainda vale. Sem isto, só a ação feita sobre a visão mais nova vale.
   */
  concurrent?: boolean
  /**
   * Cadeiras conforme as opções (ex.: truco 1x1, 2x2 ou 3x3 exige a mesa completa).
   * Sem isto, valem `minPlayers` e `maxPlayers`.
   */
  seats?(options: Options): { min: number; max: number }
  /** valida/normaliza opções vindas do cliente (o servidor nunca confia nelas cruas) */
  parseOptions(raw: unknown): Options | GameError
  setup(players: PlayerRef[], options: Options, ctx: GameCtx): Step<State, Event>
  /** valida a ação vinda do cliente (formato); a legalidade é checada em apply */
  parseAction(raw: unknown): Action | GameError
  apply(state: State, playerId: string, action: Action, ctx: GameCtx): Step<State, Event> | GameError
  /** prazos vencidos (vez estourada, próxima mão, fim por tempo). Chamado pelo alarme do servidor. */
  tick(state: State, ctx: GameCtx): Step<State, Event>
  /** próximo instante em que tick precisa rodar (ms epoch), ou null */
  nextDeadline(state: State): number | null
  /** jogador caiu/voltou: o jogo decide (ex.: fica "ausente" e é pulado nas próximas mãos) */
  setPresence(state: State, playerId: string, present: boolean, ctx: GameCtx): Step<State, Event>
  /** visão personalizada. null = espectador. NUNCA pode conter informação escondida de outro jogador. */
  view(state: State, playerId: string | null, now: number): View
  isOver(state: State): boolean
}

/** Qualquer jogo, para o registro e o GameHost. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGame = GameDefinition<any, any, any, any, any>

/** RNG determinístico (mulberry32) para testes e simulações. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return {
    int(max: number): number {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
      return Math.floor(r * max)
    }
  }
}

/** RNG do servidor: crypto, sem viés (rejeição). */
export function cryptoRng(): Rng {
  return {
    int(max: number): number {
      if (max <= 0) return 0
      const limit = Math.floor(0x100000000 / max) * max
      const buf = new Uint32Array(1)
      for (;;) {
        crypto.getRandomValues(buf)
        if (buf[0] < limit) return buf[0] % max
      }
    }
  }
}

/** Embaralha (Fisher–Yates) com o RNG dado. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
