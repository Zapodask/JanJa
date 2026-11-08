import type { GameLobby, GameId } from '../../shared/games/protocol'
import { GAMES, type GameRegistry } from '../../shared/games/registry'
import { isGameError, type AnyGame, type GameCtx, type PlayerRef, type Rng, type Step } from '../../shared/games/types'
import type { ClientMessage, ServerMessage } from '../../shared/protocol'

/**
 * Anfitrião de jogos da sala, sem nada da Cloudflare (testável no Node).
 * Guarda o lobby e o estado do jogo; cada conexão só recebe a visão do próprio jogador.
 * O `clientId` (nunca enviado a ninguém) é o que liga a pessoa à cadeira; `playerId` é público.
 */

export type GameClientMessage = Extract<ClientMessage, { type: `game-${string}` }>
export const isGameMessage = (m: ClientMessage): m is GameClientMessage => m.type.startsWith('game-')

export interface HostConn {
  send(msg: ServerMessage): void
  data(): { peerId?: string; name?: string; isHost?: boolean; clientId?: string }
}

interface SeatRec {
  seat: number
  clientId: string
  playerId: string
  name: string
}

/** O que vai para o storage: lobby + estado + seq. Presença não é guardada (vem das conexões). */
export interface GameSnapshot {
  v: 1
  gameId: GameId
  options: unknown
  openedBy: string
  openedByClientId: string
  seats: SeatRec[]
  started: boolean
  state: unknown
  seq: number
}

export interface GameHostDeps {
  /** conexões já dentro da sala */
  conns(): HostConn[]
  now(): number
  rng(): Rng
  newId(): string
  save(snapshot: GameSnapshot | null): void
  load(): GameSnapshot | undefined
  registry?: GameRegistry
}

type ErrCode = Extract<ServerMessage, { type: 'game-error' }>['code']

/** Quem não mandou clientId (cliente antigo) ainda joga, mas não recupera a cadeira. ':' não existe num clientId válido. */
const identityOf = (c: HostConn): string | undefined => {
  const d = c.data()
  return d.clientId ?? (d.peerId ? `p:${d.peerId}` : undefined)
}

const MAX_ADVANCE = 20

export class GameHost {
  private s?: GameSnapshot
  private loaded = false

  constructor(private readonly deps: GameHostDeps) {}

  private get registry(): GameRegistry {
    return this.deps.registry ?? GAMES
  }

  private session(): GameSnapshot | undefined {
    if (!this.loaded) {
      this.loaded = true
      const snap = this.deps.load()
      if (snap && snap.v === 1 && this.registry[snap.gameId]) this.s = snap
    }
    return this.s
  }

  private game(s: GameSnapshot): AnyGame {
    return this.registry[s.gameId] as AnyGame // session() só carrega jogos registrados
  }

  private ctx(): GameCtx {
    return { now: this.deps.now(), rng: this.deps.rng() }
  }

  private conns(): HostConn[] {
    return this.deps.conns().filter((c) => !!c.data().peerId)
  }

  private err(conn: HostConn, code: ErrCode, message: string): void {
    conn.send({ type: 'game-error', code, message })
  }

  private persist(): void {
    this.deps.save(this.s ?? null)
  }

  private seatOf(s: GameSnapshot, conn: HostConn): SeatRec | undefined {
    const id = identityOf(conn)
    return id ? s.seats.find((x) => x.clientId === id) : undefined
  }

  private isPresent(clientId: string): boolean {
    return this.conns().some((c) => identityOf(c) === clientId)
  }

  private canManage(s: GameSnapshot, conn: HostConn): boolean {
    return !!conn.data().isHost || identityOf(conn) === s.openedByClientId
  }

  /** quantas cadeiras a partida aberta tem (o jogo pode decidir pelas opções) */
  private limits(s: GameSnapshot): { min: number; max: number } {
    const g = this.game(s)
    return g.seats ? g.seats(s.options) : { min: g.minPlayers, max: g.maxPlayers }
  }

  private over(s: GameSnapshot): boolean {
    return s.started && this.game(s).isOver(s.state)
  }

  // ---------- envio ----------
  private lobbyFor(s: GameSnapshot, conn: HostConn): GameLobby {
    const lim = this.limits(s)
    const me = identityOf(conn)
    return {
      gameId: s.gameId,
      options: s.options,
      openedBy: s.openedBy,
      canManage: this.canManage(s, conn),
      seats: [...s.seats]
        .sort((a, b) => a.seat - b.seat)
        .map((x) => ({
          seat: x.seat,
          playerId: x.playerId,
          name: x.name,
          present: this.isPresent(x.clientId),
          you: x.clientId === me
        })),
      maxPlayers: lim.max,
      minPlayers: lim.min,
      started: s.started
    }
  }

  private sendLobby(s: GameSnapshot | undefined, conn: HostConn): void {
    conn.send({ type: 'game-lobby', lobby: s ? this.lobbyFor(s, conn) : null })
  }

  private broadcastLobby(): void {
    const s = this.s
    for (const c of this.conns()) this.sendLobby(s, c)
  }

  private sendView(s: GameSnapshot, conn: HostConn, now = this.deps.now()): void {
    if (!s.started) return
    const seat = this.seatOf(s, conn)
    conn.send({ type: 'game-view', seq: s.seq, view: this.game(s).view(s.state, seat?.playerId ?? null, now) })
  }

  private broadcastViews(s: GameSnapshot): void {
    const now = this.deps.now()
    for (const c of this.conns()) this.sendView(s, c, now)
  }

  /** Aplica um passo do jogo. Só avança seq/envia se algo mudou. */
  private commit(s: GameSnapshot, step: Step<unknown, unknown>): boolean {
    if (step.state === s.state && step.events.length === 0) return false
    s.state = step.state
    s.seq += 1
    this.persist()
    if (step.events.length) {
      for (const c of this.conns()) c.send({ type: 'game-events', seq: s.seq, events: step.events })
    }
    this.broadcastViews(s)
    return true
  }

  // ---------- entrada/saída de conexões ----------
  /** Chamado depois que a pessoa entrou na sala (conn já com peerId e clientId). */
  onJoin(conn: HostConn): void {
    const s = this.session()
    if (!s) return
    const seat = this.seatOf(s, conn)
    const others = this.conns().filter((c) => identityOf(c) === identityOf(conn)).length > 1
    if (seat && !others) {
      let sent = false
      if (s.started && !this.over(s)) {
        sent = this.commit(s, this.game(s).setPresence(s.state, seat.playerId, true, this.ctx()))
      }
      this.broadcastLobby()
      if (!sent) this.sendView(s, conn)
      return
    }
    this.sendLobby(s, conn)
    this.sendView(s, conn)
  }

  /** `closed` = dados da conexão que fechou (antes de limpá-los). */
  onClose(closed: { peerId?: string; clientId?: string }): void {
    const s = this.session()
    if (!s) return
    const id = closed.clientId ?? (closed.peerId ? `p:${closed.peerId}` : undefined)
    const seat = id ? s.seats.find((x) => x.clientId === id) : undefined
    if (!seat || this.isPresent(seat.clientId)) return
    if (s.started && !this.over(s)) this.commit(s, this.game(s).setPresence(s.state, seat.playerId, false, this.ctx()))
    this.broadcastLobby()
  }

  // ---------- mensagens ----------
  handle(conn: HostConn, msg: GameClientMessage): void {
    const s = this.session()
    const me = identityOf(conn)
    if (!me) return

    if (msg.type === 'game-open') return this.open(conn, me, msg.gameId, msg.options)
    if (!s) return this.err(conn, 'sem-jogo', 'Não há jogo aberto.')

    switch (msg.type) {
      case 'game-sit':
        return this.sit(s, conn, me, msg.seat)
      case 'game-stand':
        return this.stand(s, conn)
      case 'game-start':
        return this.start(s, conn)
      case 'game-action':
        return this.action(s, conn, msg.seq, msg.action)
      case 'game-close':
        if (!this.canManage(s, conn)) return this.err(conn, 'sem-permissao', 'Só quem abriu ou o host encerra.')
        this.s = undefined
        this.persist()
        return this.broadcastLobby()
    }
  }

  private open(conn: HostConn, me: string, gameId: GameId, rawOptions: unknown): void {
    if (this.session()) return this.err(conn, 'jogo-aberto', 'Já existe um jogo aberto nesta sala.')
    const game = this.registry[gameId]
    if (!game) return this.err(conn, 'sem-jogo', 'Jogo desconhecido.')
    const options = game.parseOptions(rawOptions)
    if (isGameError(options)) return this.err(conn, 'opcoes-invalidas', options.message)
    this.s = {
      v: 1,
      gameId,
      options,
      openedBy: conn.data().name ?? 'Alguém',
      openedByClientId: me,
      seats: [],
      started: false,
      state: null,
      seq: 0
    }
    this.persist()
    this.broadcastLobby()
  }

  private sit(s: GameSnapshot, conn: HostConn, me: string, want: number | undefined): void {
    const mine = this.seatOf(s, conn)
    if (s.started) {
      return mine ? this.sendLobby(s, conn) : this.err(conn, 'ja-comecou', 'A partida já começou.')
    }
    const max = this.limits(s).max
    const free = (n: number) => n < max && !s.seats.some((x) => x.seat === n && x !== mine)
    let seat = want
    if (seat === undefined) {
      if (mine) return this.sendLobby(s, conn)
      seat = Array.from({ length: max }, (_, i) => i).find(free)
    }
    if (seat === undefined || !free(seat)) return this.err(conn, 'mesa-cheia', 'Cadeira ocupada ou mesa cheia.')
    if (mine) mine.seat = seat
    else s.seats.push({ seat, clientId: me, playerId: this.deps.newId(), name: conn.data().name ?? 'Jogador' })
    this.persist()
    this.broadcastLobby()
  }

  private stand(s: GameSnapshot, conn: HostConn): void {
    const mine = this.seatOf(s, conn)
    if (!mine) return this.err(conn, 'nao-sentado', 'Você não está sentado.')
    if (s.started && !this.over(s)) return this.err(conn, 'ja-comecou', 'A partida já começou.')
    s.seats = s.seats.filter((x) => x !== mine)
    this.persist()
    this.broadcastLobby()
  }

  private start(s: GameSnapshot, conn: HostConn): void {
    if (!this.canManage(s, conn)) return this.err(conn, 'sem-permissao', 'Só quem abriu ou o host inicia.')
    if (s.started) return this.err(conn, 'ja-comecou', 'A partida já começou.')
    const g = this.game(s)
    const lim = this.limits(s)
    if (s.seats.length < lim.min) {
      return this.err(conn, 'jogadores-insuficientes', `Precisa de pelo menos ${lim.min} jogadores.`)
    }
    const players: PlayerRef[] = [...s.seats].sort((a, b) => a.seat - b.seat).map((x) => ({ playerId: x.playerId, name: x.name }))
    const first = g.setup(players, s.options, this.ctx())
    s.started = true
    s.state = first.state
    s.seq = 1
    this.persist()
    this.broadcastLobby()
    for (const c of this.conns()) c.send({ type: 'game-events', seq: s.seq, events: first.events })
    this.broadcastViews(s)
    // quem sentou mas já caiu começa ausente
    for (const x of [...s.seats].sort((a, b) => a.seat - b.seat)) {
      if (!this.isPresent(x.clientId)) this.commit(s, g.setPresence(s.state, x.playerId, false, this.ctx()))
    }
  }

  private action(s: GameSnapshot, conn: HostConn, seq: number, raw: unknown): void {
    const seat = this.seatOf(s, conn)
    if (!seat) return this.err(conn, 'nao-sentado', 'Você não está sentado.')
    if (!s.started) return this.err(conn, 'acao-invalida', 'A partida ainda não começou.')
    const g = this.game(s)
    if (this.over(s)) return this.err(conn, 'partida-encerrada', 'A partida acabou.')
    if (seq < s.seq && !g.concurrent) return this.err(conn, 'seq-antigo', 'Sua tela estava desatualizada. Tente de novo.')
    if (seq > s.seq) return this.err(conn, 'acao-invalida', 'Sequência inválida.')
    const action = g.parseAction(raw)
    if (isGameError(action)) return this.err(conn, action.error, action.message)
    const step = g.apply(s.state, seat.playerId, action, this.ctx())
    if (isGameError(step)) return this.err(conn, step.error, step.message)
    this.commit(s, step)
  }

  // ---------- tempo ----------
  /** Próximo instante em que onTick precisa rodar (ms epoch), ou null. */
  nextDeadline(): number | null {
    const s = this.session()
    if (!s || !s.started || this.over(s)) return null
    return this.game(s).nextDeadline(s.state)
  }

  /** Roda os prazos vencidos (alarme do servidor). */
  onTick(now: number = this.deps.now()): void {
    const s = this.session()
    if (!s || !s.started) return
    const g = this.game(s)
    for (let i = 0; i < MAX_ADVANCE && !g.isOver(s.state); i++) {
      const d = g.nextDeadline(s.state)
      if (d === null || d > now) break
      if (!this.commit(s, g.tick(s.state, { now, rng: this.deps.rng() }))) break
    }
  }

  /** Esquece tudo (sala expirou). Não grava. */
  reset(): void {
    this.s = undefined
    this.loaded = true
  }
}
