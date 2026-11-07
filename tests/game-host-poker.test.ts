import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Card, LegalAction, PokerView } from '../src/shared/games/poker/types'
import { GAMES } from '../src/shared/games/registry'
import { seededRng } from '../src/shared/games/types'
import type { ServerMessage } from '../src/shared/protocol'
import { RoomCore, type Conn, type ConnData, type RoomConfig } from '../src/worker/core'
import type { GameSnapshot } from '../src/worker/game/host'

/** Integração: servidor (RoomCore + GameHost) com o motor de poker real, por mensagens. */
const HOST_KEY = 'chave'
class C implements Conn {
  inbox: ServerMessage[] = []
  d: ConnData = {}
  constructor(public r: Room) {}
  send(m: ServerMessage) {
    this.inbox.push(m)
  }
  close() {}
  data() {
    return this.d
  }
  setData(d: ConnData) {
    this.d = d
  }
  view(): PokerView | undefined {
    return this.inbox.filter((m) => m.type === 'game-view').at(-1)?.view as PokerView | undefined
  }
  seq(): number {
    return this.inbox.filter((m) => m.type === 'game-view').at(-1)?.seq ?? 0
  }
  async say(msg: unknown) {
    await this.r.core.onMessage(this, JSON.stringify(msg))
  }
}
class Room {
  conns: C[] = []
  now = 5_000_000
  stored: GameSnapshot | null = null
  n = 0
  core = new RoomCore({
    conns: () => this.conns,
    config: (): RoomConfig => ({ hostKeyHash: createHash('sha256').update(HOST_KEY).digest('hex'), requireApproval: false }),
    hash: async (t) => createHash('sha256').update(t).digest('hex'),
    newId: () => `id${++this.n}`,
    iceServers: async () => [],
    now: () => this.now,
    rng: () => seededRng(42),
    loadGame: () => this.stored ?? undefined,
    saveGame: (s) => {
      this.stored = s ? (JSON.parse(JSON.stringify(s)) as GameSnapshot) : null
    },
    registry: GAMES
  })
  async join(name: string, key?: string) {
    const c = new C(this)
    this.conns.push(c)
    await c.say({ type: 'join', name, clientId: `cid-${name}-000000`, hostKey: key })
    return c
  }
}

describe('servidor + poker real', () => {
  it('joga mãos inteiras por mensagens e ninguém recebe cartas alheias', async () => {
    const r = new Room()
    const host = await r.join('Pedro', HOST_KEY)
    const bia = await r.join('Bia')
    const caio = await r.join('Caio')
    const watcher = await r.join('Lia')
    await host.say({ type: 'game-open', gameId: 'poker', options: { mode: 'holdem', minutes: 15, buy: 'recompra' } })
    for (const p of [host, bia, caio]) await p.say({ type: 'game-sit' })
    await host.say({ type: 'game-start' })
    const players = [host, bia, caio]
    expect(host.view()?.phase).toBe('preflop')

    const leaked = (v: PokerView): boolean => {
      const mine = new Set<Card>(v.you?.hand ?? [])
      if (v.phase === 'intervalo' || v.phase === 'fim') return false // showdown revela de propósito
      return v.seats.some((s) => s.cards?.some((c) => !mine.has(c)) ?? false)
    }

    let hands = 0
    for (let step = 0; step < 400 && hands < 6; step++) {
      for (const c of [...players, watcher]) {
        const v = c.view()!
        expect(leaked(v)).toBe(false)
      }
      expect(watcher.view()!.you).toBeNull()
      const v = host.view()!
      if (v.phase === 'intervalo') {
        const before = v.handNo
        hands++
        r.now = Math.max(r.now, r.core.game.nextDeadline() ?? r.now) + 1
        r.core.game.onTick(r.now)
        // a próxima mão começou de verdade (o intervalo não fica contando a mesma mão)
        expect(host.view()!.handNo).toBe(before + 1)
        continue
      }
      const actor = players.find((p) => p.view()!.toAct !== null && p.view()!.legal.length > 0)
      expect(actor, 'alguém tem a vez com ações legais').toBeTruthy()
      const legal: LegalAction[] = actor!.view()!.legal
      const pick = legal.find((a) => a.kind === 'call') ?? legal.find((a) => a.kind === 'check') ?? legal[0]
      await actor!.say({ type: 'game-action', seq: actor!.seq(), action: { kind: pick.kind } })
    }
    expect(hands).toBeGreaterThanOrEqual(3)
    // fichas: total na mesa + nos potes == 3000 + recompras
    const v = host.view()!
    const total = v.seats.reduce((s, x) => s + x.stack + x.bet, 0) + v.pots.reduce((s, p) => s + p.amount, 0)
    const rebuys = v.seats.reduce((s, x) => s + x.rebuys, 0)
    expect(total).toBe(3000 + rebuys * 1000)
  })

  it('recusa ação fora da vez e de quem só assiste', async () => {
    const r = new Room()
    const host = await r.join('Pedro', HOST_KEY)
    const bia = await r.join('Bia')
    const lia = await r.join('Lia')
    await host.say({ type: 'game-open', gameId: 'poker', options: { mode: 'holdem', minutes: 15, buy: 'recompra' } })
    await host.say({ type: 'game-sit' })
    await bia.say({ type: 'game-sit' })
    await host.say({ type: 'game-start' })
    const notTurn = [host, bia].find((p) => p.view()!.legal.length === 0)!
    await notTurn.say({ type: 'game-action', seq: notTurn.seq(), action: { kind: 'call' } })
    await lia.say({ type: 'game-action', seq: lia.seq(), action: { kind: 'call' } })
    const codes = (c: C) => c.inbox.filter((m) => m.type === 'game-error').map((m) => (m as { code: string }).code)
    expect(codes(notTurn)).toContain('nao-e-sua-vez')
    expect(codes(lia).length).toBeGreaterThan(0)
  })
})
