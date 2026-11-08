import { describe, expect, it } from 'vitest'
import { BOT_SLOT_BASE, BTN_FIRE, DEFAULT_SHOOTER_OPTIONS, type ShooterAction, type ShooterView, type SimPlayer } from '../../src/shared/games/shooter/types'
import { decodePacket, encodeHello, encodePing, toBase64 } from '../../src/shared/games/shooter/codec'
import { sim } from '../../src/shared/games/shooter/sim'
import { HostLoop } from '../../src/web/game/shooter/net/hostCore'
import { createShooterSession, type ManagedShooterSession, type SessionEnv } from '../../src/web/game/shooter/net/session'
import { Transport, type GameLink } from '../../src/web/game/shooter/net/transport'
import { createLocalSession } from '../../src/web/game/shooter/net/local'
import type { PeerManager } from '../../src/web/rtc/PeerManager'

// ---------------------------------------------------------------------------------
// Rede simulada em memória, com relógio virtual
// ---------------------------------------------------------------------------------

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

interface LinkCfg {
  delay: number
  jitter: number
  loss: number
}

class VNet {
  T = 0
  private timers: { next: number; ms: number; fn: () => void; dead: boolean }[] = []
  private queue: { at: number; n: number; fn: () => void }[] = []
  private n = 0
  rnd = lcg(2024)
  every(ms: number, fn: () => void): () => void {
    const t = { next: this.T + ms, ms, fn, dead: false }
    this.timers.push(t)
    return () => (t.dead = true)
  }
  after(delay: number, fn: () => void) {
    this.queue.push({ at: this.T + Math.max(0, delay), n: this.n++, fn })
  }
  /** avança 1 ms */
  tick() {
    this.T += 1
    for (;;) {
      const due = this.queue.filter((q) => q.at <= this.T).sort((a, b) => a.at - b.at || a.n - b.n)
      if (!due.length) break
      this.queue = this.queue.filter((q) => q.at > this.T)
      for (const q of due) q.fn()
    }
    for (const t of this.timers) {
      if (t.dead) continue
      while (t.next <= this.T && !t.dead) {
        t.next += t.ms
        t.fn()
      }
    }
    this.timers = this.timers.filter((t) => !t.dead)
  }
  run(ms: number) {
    for (let i = 0; i < ms; i++) this.tick()
  }
}

class FakeManager implements GameLink {
  readonly open = new Set<string>()
  private readonly gameCbs = new Set<(peer: string, data: ArrayBuffer) => void>()
  private readonly stateCbs = new Set<(peer: string, open: boolean) => void>()
  constructor(
    readonly player: string,
    private readonly world: World
  ) {}
  sendGame(peer: string, data: ArrayBuffer): boolean {
    if (!this.open.has(peer)) return false
    this.world.p2p(this.player, peer, data)
    return true
  }
  gameOpen = (peer: string) => this.open.has(peer)
  openGamePeers = () => [...this.open]
  onGame(cb: (peer: string, data: ArrayBuffer) => void) {
    this.gameCbs.add(cb)
    return () => this.gameCbs.delete(cb)
  }
  onGameState(cb: (peer: string, open: boolean) => void) {
    this.stateCbs.add(cb)
    return () => this.stateCbs.delete(cb)
  }
  receive(fromPeer: string, data: ArrayBuffer) {
    for (const cb of this.gameCbs) cb(fromPeer, data)
  }
  setOpen(peer: string, open: boolean) {
    if (open) this.open.add(peer)
    else this.open.delete(peer)
    for (const cb of this.stateCbs) cb(peer, open)
  }
}

const peerOf = (player: string) => `peer-${player}`

class World {
  net = new VNet()
  managers = new Map<string, FakeManager>()
  relayListeners = new Map<string, Set<(from: string, data: string) => void>>()
  /** pares com canal P2P aberto -> config */
  links = new Map<string, LinkCfg>()
  dead = new Set<string>()
  relayCfg: LinkCfg = { delay: 40, jitter: 10, loss: 0 }
  relayCount = 0
  p2pCount = 0
  acts: { player: string; action: ShooterAction }[] = []

  manager(player: string): FakeManager {
    let m = this.managers.get(player)
    if (!m) this.managers.set(player, (m = new FakeManager(player, this)))
    return m
  }
  private key(a: string, b: string) {
    return [a, b].sort().join('|')
  }
  connect(a: string, b: string, cfg: LinkCfg) {
    this.links.set(this.key(a, b), cfg)
    this.manager(a).setOpen(peerOf(b), true)
    this.manager(b).setOpen(peerOf(a), true)
  }
  p2p(from: string, toPeer: string, data: ArrayBuffer) {
    const to = toPeer.replace('peer-', '')
    const cfg = this.links.get(this.key(from, to))
    if (!cfg || this.dead.has(from) || this.dead.has(to)) return
    this.p2pCount++
    if (this.net.rnd() < cfg.loss) return
    const copy = data.slice(0)
    this.net.after(cfg.delay + this.net.rnd() * cfg.jitter, () => {
      if (!this.dead.has(to)) this.manager(to).receive(peerOf(from), copy)
    })
  }
  relay(from: string, to: string, data: string, seated: string[]) {
    if (this.dead.has(from)) return
    this.relayCount++
    const targets = to === '*' ? seated.filter((p) => p !== from) : [to]
    for (const t of targets) {
      this.net.after(this.relayCfg.delay + this.net.rnd() * this.relayCfg.jitter, () => {
        if (this.dead.has(t)) return
        for (const cb of this.relayListeners.get(t) ?? []) cb(from, data)
      })
    }
  }
}

interface Player {
  id: string
  slot: number
  session: ManagedShooterSession
  host?: HostLoop
}

function setup(world: World, ids: string[], opts: { bots?: number } = {}) {
  const bots = opts.bots ?? 0
  const players: ShooterView['players'] = [
    ...ids.map((id, i) => ({ id, name: id, slot: i, bot: false, present: true })),
    ...Array.from({ length: bots }, (_, i) => ({ id: `bot-${i + 1}`, name: `Robô ${i + 1}`, slot: BOT_SLOT_BASE + i, bot: true, present: true }))
  ]
  const baseView = (id: string): ShooterView => ({
    you: { playerId: id, slot: ids.indexOf(id) },
    options: { ...DEFAULT_SHOOTER_OPTIONS, bots },
    phase: 'jogando',
    players,
    hostId: ids[0],
    epoch: 1,
    seed: 4242,
    createdAt: 0,
    scores: [],
    ranking: null
  })
  const apply = new Map<string, number[]>()
  const out: Record<string, Player> = {}
  const seated = () => ids.filter((p) => !world.dead.has(p))
  for (const id of ids) {
    const player: Player = { id, slot: ids.indexOf(id), session: undefined as unknown as ManagedShooterSession }
    const env: SessionEnv = {
      now: () => world.net.T,
      every: (ms, fn) => world.net.every(ms, fn),
      createRunner(init, o) {
        const loop = new HostLoop(sim, init, o, world.net.T)
        loop.onApply = (slot, seq) => {
          const k = `${init.epoch}:${slot}`
          const list = apply.get(k) ?? []
          list.push(seq)
          apply.set(k, list)
        }
        player.host = loop
        const stop = world.net.every(8, () => loop.advance(world.net.T))
        return {
          kind: 'main',
          handle: (m) => loop.handle(m),
          dispose: () => {
            stop()
            loop.handle({ k: 'stop' })
          }
        }
      }
    }
    player.session = createShooterSession(
      {
        view: baseView(id),
        manager: world.manager(id) as unknown as PeerManager,
        relay: (to, data) => world.relay(id, to, data, seated()),
        onRelay: (cb) => {
          const set = world.relayListeners.get(id) ?? new Set()
          world.relayListeners.set(id, set)
          set.add(cb)
          return () => set.delete(cb)
        },
        act: (action) => world.acts.push({ player: id, action })
      },
      env
    )
    out[id] = player
  }
  return { players: out, baseView, apply, ids, playerList: players }
}

/** controle aleatório: troca de direção a cada ~400 ms, atira metade do tempo */
function driver(world: World, p: Player, seed: number) {
  const rnd = lcg(seed)
  let ax = 1
  let ay = 0
  let mx = 0
  let my = 0
  let fire = 0
  let until = 0
  let active = true
  world.net.every(20, () => {
    if (!active) {
      p.session.setInput({ mx: 0, my: 0, ax, ay, buttons: 0 })
      return
    }
    if (world.net.T >= until) {
      until = world.net.T + 200 + rnd() * 400
      const a = rnd() * Math.PI * 2
      mx = Math.cos(a)
      my = Math.sin(a)
      const b = rnd() * Math.PI * 2
      ax = Math.cos(b)
      ay = Math.sin(b)
      fire = rnd() < 0.5 ? BTN_FIRE : 0
    }
    p.session.setInput({ mx, my, ax, ay, buttons: fire })
  })
  return { stop: () => (active = false) }
}

const ids = ['host-aaaa', 'cli-bbbb', 'cli-cccc', 'cli-dddd']

function build(extra: { bots?: number } = {}) {
  const world = new World()
  const s = setup(world, ids, extra)
  // host <-> bbbb, host <-> cccc, bbbb <-> cccc por P2P (com atraso, jitter e perda); dddd só por repasse
  world.net.run(50)
  world.connect(ids[0], ids[1], { delay: 30, jitter: 20, loss: 0.05 })
  world.connect(ids[0], ids[2], { delay: 45, jitter: 25, loss: 0.08 })
  world.connect(ids[1], ids[2], { delay: 40, jitter: 20, loss: 0.05 })
  return { world, ...s }
}

describe('rede simulada: host + 3 clientes por 20 s', () => {
  it('prediz perto do host, não repete entrada, mostra todos e usa P2P e repasse', () => {
    const { world, players, apply } = build({ bots: 1 })
    const drivers = ids.map((id, i) => driver(world, players[id], 100 + i))
    const errors: number[] = []
    for (let s = 0; s < 20; s++) {
      world.net.run(1000)
      if (s >= 3) {
        for (const id of ids.slice(1)) {
          const pred = players[id].session.debug.client().predicted
          const host = players[ids[0]].host!.state.players.find((p) => p.slot === players[id].slot)!
          if (pred && host.alive && pred.alive) errors.push(Math.hypot(pred.x - host.x, pred.y - host.y))
        }
      }
    }
    // papéis e rotas
    expect(players[ids[0]].session.role()).toBe('host')
    expect(players[ids[1]].session.role()).toBe('client')
    expect(world.relayCount).toBeGreaterThan(0)
    expect(world.p2pCount).toBeGreaterThan(0)
    const netOf = (id: string) => players[id].session.frame()!.net
    expect(netOf(ids[0])).toBe('host')
    expect(netOf(ids[1])).toBe('p2p')
    expect(netOf(ids[2])).toBe('p2p')
    expect(netOf(ids[3])).toBe('relay')

    // todos veem todos (4 humanos + 1 robô)
    for (const id of ids) {
      const f = players[id].session.frame()!
      expect(f.players.length).toBe(5)
      expect(f.me).toBe(players[id].slot)
      expect(f.scores).toHaveLength(5)
      if (id !== ids[0]) expect(f.pingMs).toBeGreaterThan(20)
    }

    // predição: erro médio pequeno durante o jogo
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length
    console.log(`erro médio de predição ${mean.toFixed(2)} px (n=${errors.length}), máx ${Math.max(...errors).toFixed(1)} px`)
    // (o previsto anda à frente do host por ~meio RTT de entradas em voo; o ajuste fino é conferido abaixo)
    expect(mean).toBeLessThan(20)

    // solta tudo e espera: o previsto converge para o host
    drivers.forEach((d) => d.stop())
    world.net.run(1500)
    for (const id of ids.slice(1)) {
      const pred = players[id].session.debug.client().predicted!
      const host = players[ids[0]].host!.state.players.find((p) => p.slot === players[id].slot)!
      expect(Math.hypot(pred.x - host.x, pred.y - host.y)).toBeLessThan(3)
    }

    // cada seq uma única vez, em ordem crescente, por jogador
    let total = 0
    for (const [k, list] of apply) {
      total += list.length
      for (let i = 1; i < list.length; i++) expect(list[i], `slot ${k}`).toBeGreaterThan(list[i - 1])
    }
    expect(total).toBeGreaterThan(3 * 20 * 30) // a maior parte das ~800 entradas por jogador chegou

    // o host mandou placar ao coordenador a cada 5 s
    const scoreActs = world.acts.filter((a) => a.action.type === 'score')
    expect(scoreActs.length).toBeGreaterThanOrEqual(3)
    expect(scoreActs.every((a) => a.player === ids[0] && a.action.epoch === 1)).toBe(true)
    for (const id of ids) players[id].session.dispose()
  })

  it('cai o host: o cliente promovido continua do último retrato com o placar preservado', () => {
    const { world, players, baseView, playerList } = build({ bots: 1 })
    ids.forEach((id, i) => driver(world, players[id], 7 + i))
    world.net.run(12_000)
    // placar conhecido (a partida aleatória quase não mata em 12 s)
    const hs = players[ids[0]].host!.state.players
    hs.find((p) => p.slot === 1)!.kills = 5
    hs.find((p) => p.slot === 2)!.deaths = 3
    hs.find((p) => p.slot === 2)!.damage = 140
    world.net.run(1500)

    // placar e tick que os clientes viam antes da queda
    const before = players[ids[1]].session.frame()!
    const tickBefore = players[ids[1]].session.debug.lastSnapshot()!.tick
    const lastSnap = players[ids[1]].session.debug.lastSnapshot()!
    const killsBefore = new Map(lastSnap.players.map((p) => [p.slot, p.kills]))
    expect(before.scores.find((x) => x.id === ids[1])?.kills).toBe(5)

    // host cai
    world.dead.add(ids[0])
    players[ids[0]].session.dispose()
    world.manager(ids[1]).setOpen(peerOf(ids[0]), false)
    world.manager(ids[2]).setOpen(peerOf(ids[0]), false)
    const view2 = (id: string): ShooterView => ({
      ...baseView(id),
      hostId: ids[1],
      epoch: 2,
      players: playerList.map((p) => (p.id === ids[0] ? { ...p, present: false } : p))
    })
    for (const id of ids.slice(1)) players[id].session.update(view2(id))

    const newHost = players[ids[1]]
    expect(newHost.session.role()).toBe('host')
    expect(newHost.host).toBeDefined()
    // logo depois da troca o estado é o do último retrato (placar igual)
    for (const p of newHost.host!.state.players) expect(p.kills).toBeGreaterThanOrEqual(killsBefore.get(p.slot) ?? 0)
    expect(newHost.host!.state.players.find((p) => p.slot === 1)!.kills).toBeGreaterThanOrEqual(5)
    expect(newHost.host!.state.players.find((p) => p.slot === 2)).toMatchObject({ deaths: 3, damage: 140 })
    expect(newHost.host!.state.tick).toBeGreaterThanOrEqual(lastSnap.tick)
    expect(newHost.host!.state.tick).toBeLessThan(tickBefore + 40)
    expect(players[ids[2]].session.frame()!.net).toBe('trocando-host')
    const awayHost = newHost.host!.state.players.find((p) => p.slot === 0)!
    expect(awayHost.away).toBe(true)

    world.net.run(6000)
    // o jogo continuou: tick andou, o novo host manda snapshots do epoch 2 e todos os vivos veem tudo
    expect(newHost.host!.state.tick).toBeGreaterThan(tickBefore + 100)
    for (const id of ids.slice(2)) {
      const f = players[id].session.frame()!
      expect(f.net === 'p2p' || f.net === 'relay').toBe(true)
      expect(players[id].session.debug.lastSnapshot()!.epoch).toBe(2)
      expect(players[id].session.debug.lastSnapshot()!.tick).toBeGreaterThan(tickBefore + 100)
      // placar nunca diminui
      for (const s of f.scores) {
        const slot = players[id].session.debug.lastSnapshot()!.players.find((p) => p.kills === s.kills && p.deaths === s.deaths)?.slot
        void slot
      }
      const snap = players[id].session.debug.lastSnapshot()!
      for (const p of snap.players) expect(p.kills).toBeGreaterThanOrEqual(killsBefore.get(p.slot) ?? 0)
      expect(f.players.some((p) => p.bot)).toBe(true)
    }
    // o host novo informa o placar ao coordenador no epoch 2
    const acts2 = world.acts.filter((a) => a.action.type === 'score' && a.action.epoch === 2)
    expect(acts2.length).toBeGreaterThanOrEqual(1)
    expect(acts2.every((a) => a.player === ids[1])).toBe(true)
    // o boneco previsto de quem ficou continua certo
    const pred = players[ids[2]].session.debug.client().predicted as SimPlayer
    expect(pred).not.toBeNull()
    for (const id of ids.slice(1)) players[id].session.dispose()
  })
})

describe('transporte', () => {
  function pair() {
    const world = new World()
    const view = { a: ['a-id-00001', 'b-id-00002'] }
    const mk = (self: string, others: string[]) => {
      const t = new Transport({
        selfId: self,
        epoch: () => 1,
        link: () => world.manager(self),
        relay: (to, data) => world.relay(self, to, data, others.concat(self)),
        onRelay: (cb) => {
          const set = world.relayListeners.get(self) ?? new Set()
          world.relayListeners.set(self, set)
          set.add(cb)
          return () => set.delete(cb)
        },
        others: () => others
      })
      const got: [string, number][] = []
      t.onPacket((from, d) => got.push([from, d.byteLength]))
      return { t, got }
    }
    const [A, B] = view.a
    return { world, A, B, a: mk(A, [B]), b: mk(B, [A]) }
  }

  it('sem canal usa o repasse; com canal aberto mas sem HELLO ainda usa o repasse; depois do HELLO vai por P2P', () => {
    const { world, A, B, a, b } = pair()
    const ping = encodePing(1)
    expect(a.t.routeTo(B)).toBe('relay')
    a.t.send(B, ping)
    world.net.run(100)
    expect(b.got).toEqual([[A, ping.byteLength]])
    expect(world.relayCount).toBe(1)

    // canal abre: HELLO nos dois sentidos mapeia peerId <-> playerId
    world.connect(A, B, { delay: 10, jitter: 0, loss: 0 })
    expect(a.t.routeTo(B)).toBe('relay') // ainda não houve HELLO
    world.net.run(100)
    expect(a.t.routeTo(B)).toBe('p2p')
    expect(b.t.routeTo(A)).toBe('p2p')
    a.t.send(B, ping)
    b.t.send('*', ping)
    world.net.run(100)
    expect(world.relayCount).toBe(1)
    expect(b.got.length).toBe(2)
    expect(a.got).toEqual([[B, ping.byteLength]])

    // canal fecha: volta para o repasse
    world.manager(A).setOpen(peerOf(B), false)
    expect(a.t.routeTo(B)).toBe('relay')
    a.t.send('*', ping)
    world.net.run(100)
    expect(world.relayCount).toBe(2)
  })

  it('HELLO perdido é repetido até o outro lado responder', () => {
    const { world, A, B, a, b } = pair()
    world.connect(A, B, { delay: 5, jitter: 0, loss: 1 }) // perde tudo
    world.net.every(100, () => {
      a.t.tick(world.net.T)
      b.t.tick(world.net.T)
    })
    world.net.run(2500)
    expect(a.t.routeTo(B)).toBe('relay')
    world.links.get([A, B].sort().join('|'))!.loss = 0
    world.net.run(2500)
    expect(a.t.routeTo(B)).toBe('p2p')
    expect(b.t.routeTo(A)).toBe('p2p')
  })

  it("'*' manda P2P a quem tem canal e UM repasse se alguém ficou sem", () => {
    const world = new World()
    const [A, B, C] = ['a-id-00001', 'b-id-00002', 'c-id-00003']
    const mk = (self: string, others: string[]) => {
      const t = new Transport({
        selfId: self,
        epoch: () => 1,
        link: () => world.manager(self),
        relay: (to, data) => world.relay(self, to, data, [A, B, C]),
        onRelay: (cb) => {
          const set = world.relayListeners.get(self) ?? new Set()
          world.relayListeners.set(self, set)
          set.add(cb)
          return () => set.delete(cb)
        },
        others: () => others
      })
      const got: string[] = []
      t.onPacket((from) => got.push(from))
      return { t, got }
    }
    const a = mk(A, [B, C])
    const b = mk(B, [A, C])
    const c = mk(C, [A, B])
    world.connect(A, B, { delay: 5, jitter: 0, loss: 0 })
    world.net.run(50)
    a.t.send('*', encodePing(9))
    world.net.run(100)
    expect(world.relayCount).toBe(1) // só por causa do C
    expect(b.got.length).toBe(2) // por P2P e pelo repasse '*' (o cliente descarta o repetido pelo tick)
    expect(c.got).toEqual([A])
    world.connect(A, C, { delay: 5, jitter: 0, loss: 0 })
    world.net.run(50)
    a.t.send('*', encodePing(9))
    expect(world.relayCount).toBe(1)
  })

  it('lixo no repasse e HELLO pelo repasse são ignorados', () => {
    const { world, A, B, a, b } = pair()
    const set = world.relayListeners.get(B)!
    for (const cb of set) {
      cb(A, '@@@@')
      cb(A, toBase64(encodeHello(A, 1)))
    }
    expect(b.got).toEqual([])
    expect(a.got).toEqual([])
    expect(decodePacket(encodeHello(A, 1))?.t).toBe('hello')
  })
})

describe('sessão local', () => {
  it('você e robôs jogam sozinhos e geram quadros e eventos', () => {
    const net = new VNet()
    const s = createLocalSession({ mapId: 'casa', bots: 3, minutes: 3, killLimit: 10, seed: 5 }, { now: () => net.T, every: (ms, fn) => net.every(ms, fn) })
    const events: string[] = []
    s.onEvents((e) => events.push(...e.map((x) => x.type + (('local' in x && x.local) ? ':local' : ''))))
    expect(s.frame()).toBeNull()
    let fire = true
    net.every(20, () => s.setInput({ mx: 1, my: 0.2, ax: 1, ay: 0, buttons: fire ? BTN_FIRE : 0 }))
    net.run(8000)
    const f = s.frame()!
    expect(f.me).toBe(0)
    expect(f.net).toBe('host')
    expect(f.players.filter((p) => p.bot)).toHaveLength(3)
    expect(f.players.find((p) => p.me)?.id).toBe('voce')
    expect(f.phase).toBe('jogando')
    expect(events).toContain('shot:local')
    expect(s.sim().players[0].slot).toBe(0)
    expect(s.sim().tick).toBeGreaterThan(150)
    fire = false
    s.dispose()
  })
})
