import { describe, expect, it } from 'vitest'
import {
  decodeHello,
  decodeInput,
  decodePacket,
  decodePing,
  decodeSnapshot,
  encodeHello,
  encodeInput,
  encodePing,
  encodeSnapshot,
  fromBase64,
  quantizeInput,
  restoreState,
  snapshotFromState,
  toBase64,
  MAX_PACKET_BYTES,
  type TimedEvent
} from '../../src/shared/games/shooter/codec'
import { sim } from '../../src/shared/games/shooter/sim'
import {
  BOT_SLOT_BASE,
  BTN_FIRE,
  DEFAULT_SHOOTER_OPTIONS,
  type Input,
  type SimEvent,
  type SimPlayerRef,
  type SimState
} from '../../src/shared/games/shooter/types'
import { RELAY_MAX_DATA } from '../../src/shared/games/protocol'

const refs = (humans: number, bots: number): SimPlayerRef[] => [
  ...Array.from({ length: humans }, (_, i) => ({ slot: i, id: `player-${i}-abcdef`, bot: false })),
  ...Array.from({ length: bots }, (_, i) => ({ slot: BOT_SLOT_BASE + i, id: `bot-${i + 1}`, bot: true }))
]

/** LCG simples só para os testes */
function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function randomInputs(state: SimState, rnd: () => number, seqs: Map<number, number>): Map<number, Input> {
  const m = new Map<number, Input>()
  for (const p of state.players) {
    if (p.bot) continue
    const seq = (seqs.get(p.slot) ?? 0) + 1
    seqs.set(p.slot, seq)
    const a = rnd() * Math.PI * 2
    m.set(p.slot, { seq, mx: Math.cos(a), my: Math.sin(a), ax: Math.cos(a * 3), ay: Math.sin(a * 3), buttons: rnd() < 0.5 ? BTN_FIRE : 0 })
  }
  return m
}

function play(state: SimState, ticks: number, seed = 5): TimedEvent[] {
  const rnd = lcg(seed)
  const seqs = new Map<number, number>()
  const events: TimedEvent[] = []
  for (let i = 0; i < ticks; i++) {
    const t0 = state.tick
    for (const ev of sim.step(state, randomInputs(state, rnd, seqs))) events.push({ tick: t0, ev })
  }
  return events
}

describe('pacotes simples', () => {
  it('HELLO ida e volta', () => {
    const p = decodeHello(encodeHello('player-xyz_123', 7, true))
    expect(p).toEqual({ t: 'hello', playerId: 'player-xyz_123', epoch: 7, reply: true })
    expect(decodeHello(encodeHello('ç-ã', 1))?.playerId).toBe('ç-ã')
  })

  it('INPUT ida e volta (quantizado) e só as últimas entradas', () => {
    const inputs: Input[] = Array.from({ length: 4 }, (_, i) => ({
      seq: 4_000_000_000 + i,
      mx: 0.5 - i * 0.3,
      my: -1,
      ax: 0.6,
      ay: -0.8,
      buttons: i
    }))
    const p = decodeInput(encodeInput(300, 5, inputs))!
    expect(p.epoch).toBe(300)
    expect(p.slot).toBe(5)
    expect(p.inputs.map((i) => i.seq)).toEqual(inputs.map((i) => i.seq))
    expect(p.inputs.map((i) => i.buttons)).toEqual([0, 1, 2, 3])
    for (let i = 0; i < 4; i++) {
      const q = quantizeInput(inputs[i])
      expect(p.inputs[i]).toEqual(q)
      expect(Math.abs(q.mx - inputs[i].mx)).toBeLessThan(0.01)
    }
    expect(decodeInput(encodeInput(1, 0, Array(20).fill(inputs[0])))!.inputs).toHaveLength(8)
  })

  it('PING e PONG', () => {
    expect(decodePing(encodePing(123456))).toEqual({ t: 'ping', n: 123456 })
    expect(decodePing(encodePing(4_294_967_295, true))).toEqual({ t: 'pong', n: 4_294_967_295 })
  })
})

describe('snapshot', () => {
  it('ida e volta de um estado de verdade (cheio e simples)', () => {
    const state = sim.createSim(refs(3, 2), { ...DEFAULT_SHOOTER_OPTIONS, bots: 2 }, 99)
    const events = play(state, 400)
    const recent = events.filter((e) => e.tick > state.tick - 6)
    for (const full of [true, false]) {
      const snap = snapshotFromState(state, recent, { epoch: 3, full })
      const back = decodeSnapshot(encodeSnapshot(snap))!
      expect(back).not.toBeNull()
      expect(back.epoch).toBe(3)
      expect(back.tick).toBe(state.tick)
      expect(back.phase).toBe(state.phase)
      expect(back.mapId).toBe(state.mapId)
      expect(back.rng).toBe(state.rng >>> 0)
      expect(back.nextId).toBe(state.nextId)
      expect(back.players).toHaveLength(5)
      expect(back.statics !== null).toBe(full)
      back.players.forEach((q, i) => {
        const p = state.players[i]
        expect(q.slot).toBe(p.slot)
        expect(q.hp).toBe(p.hp)
        expect(q.alive).toBe(p.alive)
        expect(q.kills).toBe(p.kills)
        expect(q.deaths).toBe(p.deaths)
        expect(q.weapon).toBe(p.weapon)
        expect(q.ammo).toBe(p.ammo)
        expect(q.lastSeq).toBe(p.lastSeq)
        expect(Math.abs(q.x - p.x)).toBeLessThanOrEqual(0.0625)
        expect(Math.abs(q.y - p.y)).toBeLessThanOrEqual(0.0625)
      })
      expect(back.projectiles.map((p) => p.id)).toEqual(state.projectiles.map((p) => p.id))
      expect(back.events.map((e) => [e.tick, e.ev.type])).toEqual(recent.map((e) => [e.tick, e.ev.type]))
      if (full) expect(back.statics!.ids[BOT_SLOT_BASE]).toBe('bot-1')
    }
  })

  it('todos os tipos de evento sobrevivem à ida e volta', () => {
    const state = sim.createSim(refs(2, 0), DEFAULT_SHOOTER_OPTIONS, 1)
    const evs: SimEvent[] = [
      { type: 'shot', slot: 1, weapon: 'rifle', x: 10.5, y: 20.25, ax: 0, ay: 1 },
      { type: 'grenade', slot: 0, x: 3, y: 4 },
      { type: 'hit', victim: 1, attacker: 0, damage: 70, x: 5, y: 6 },
      { type: 'kill', victim: 1, killer: 0, weapon: 'granada', streak: 3 },
      { type: 'kill', victim: 0, killer: 1, weapon: 'rolha', streak: 0 },
      { type: 'spawn', slot: 0, x: 40, y: 50 },
      { type: 'pickup', slot: 0, kind: 'vida', pickupId: 4 },
      { type: 'explode', x: 7, y: 8, radius: 36 },
      { type: 'wall', x: 9, y: 9 },
      { type: 'dash', slot: 1 },
      { type: 'phase', phase: 'fim' }
    ]
    const timed = evs.map((ev, i) => ({ tick: state.tick - (i % 3), ev }))
    const back = decodeSnapshot(encodeSnapshot(snapshotFromState(state, timed, { epoch: 1 })))!
    expect(back.events.map((e) => e.ev.type)).toEqual(evs.map((e) => e.type))
    expect(back.events.map((e) => e.tick)).toEqual(timed.map((e) => e.tick))
    expect(back.events[0].ev).toMatchObject({ type: 'shot', weapon: 'rifle', x: 10.5, y: 20.25 })
    expect(back.events[3].ev).toMatchObject({ type: 'kill', weapon: 'granada', streak: 3 })
    expect(back.events[6].ev).toEqual({ type: 'pickup', slot: 0, kind: 'vida', pickupId: 4 })
  })

  it('tamanho com 12 jogadores e 60 projéteis fica abaixo de 1200 bytes e cabe no repasse', () => {
    const state = sim.createSim(refs(8, 4), { ...DEFAULT_SHOOTER_OPTIONS, bots: 4 }, 7)
    play(state, 300)
    // enche de projéteis (pior caso)
    for (let i = 0; state.projectiles.length < 60; i++) {
      state.projectiles.push({
        id: state.nextId++,
        owner: i % 12 < 8 ? i % 12 : BOT_SLOT_BASE + (i % 4),
        kind: 'bala',
        weapon: 'sub',
        x: 40 + i * 7,
        y: 60 + i * 5,
        vx: 400,
        vy: -200,
        damage: 8,
        dieTick: state.tick + 30
      })
    }
    const events: TimedEvent[] = Array.from({ length: 10 }, (_, i) => ({ tick: state.tick - (i % 5), ev: { type: 'shot', slot: i % 8, weapon: 'sub', x: 1, y: 2, ax: 1, ay: 0 } }))
    const plain = encodeSnapshot(snapshotFromState(state, events, { epoch: 2 })).byteLength
    const full = encodeSnapshot(snapshotFromState(state, events, { epoch: 2, full: true })).byteLength
    console.log(`snapshot 12 jogadores + 60 projéteis + 10 eventos: simples ${plain} B, cheio ${full} B`)
    expect(plain).toBeLessThan(1200)
    expect(full).toBeLessThan(1500)
    expect(full).toBeLessThan(MAX_PACKET_BYTES)
    expect(toBase64(new ArrayBuffer(full)).length).toBeLessThan(RELAY_MAX_DATA)
  })

  it('projéteis de ids grandes voltam com o id completo', () => {
    const state = sim.createSim(refs(1, 0), DEFAULT_SHOOTER_OPTIONS, 1)
    state.nextId = 200_000
    state.projectiles.push({ id: 199_990, owner: 0, kind: 'granada', weapon: 'granada', x: 5, y: 5, vx: -120, vy: 160, damage: 90, dieTick: state.tick + 20 })
    const back = decodeSnapshot(encodeSnapshot(snapshotFromState(state, [], { epoch: 1 })))!
    expect(back.projectiles[0]).toMatchObject({ id: 199_990, kind: 'granada', weapon: 'granada', damage: 90 })
    expect(Math.abs(back.projectiles[0].vx + 120)).toBeLessThanOrEqual(1)
    expect(Math.abs(back.projectiles[0].vy - 160)).toBeLessThanOrEqual(1)
  })
})

describe('restoreState', () => {
  it('devolve um estado equivalente e a partida continua por 400 ticks (com robôs e tiros)', () => {
    const orig = sim.createSim(refs(3, 3), { ...DEFAULT_SHOOTER_OPTIONS, bots: 3 }, 1234)
    play(orig, 300, 11)
    const snap = decodeSnapshot(encodeSnapshot(snapshotFromState(orig, [], { epoch: 2, full: true })))!
    const back = restoreState(snap)
    expect(back.tick).toBe(orig.tick)
    expect(back.players.map((p) => p.id)).toEqual(orig.players.map((p) => p.id))
    expect(back.pickups.map((k) => [k.kind, k.x, k.y])).toEqual(orig.pickups.map((k) => [k.kind, k.x, k.y]))
    expect(back.players.map((p) => [p.kills, p.deaths, p.damage])).toEqual(orig.players.map((p) => [p.kills, p.deaths, p.damage]))
    // ambos seguem com as mesmas entradas
    const a = sim.cloneState(orig)
    const seqsA = new Map(orig.players.map((p) => [p.slot, p.lastSeq]))
    const seqsB = new Map(seqsA)
    const rA = lcg(77)
    const rB = lcg(77)
    for (let i = 0; i < 400; i++) {
      sim.step(a, randomInputs(a, rA, seqsA))
      sim.step(back, randomInputs(back, rB, seqsB))
    }
    expect(back.tick).toBe(a.tick)
    expect(back.phase).toBe(a.phase)
    for (const p of back.players) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.hp)).toBe(true)
      expect(p.hp).toBeGreaterThanOrEqual(0)
    }
    // o placar só cresce a partir do restaurado
    for (const p of back.players) {
      const o = orig.players.find((q) => q.slot === p.slot)!
      expect(p.kills).toBeGreaterThanOrEqual(o.kills)
      expect(p.deaths).toBeGreaterThanOrEqual(o.deaths)
    }
  })

  it('sem tiros nem robôs, o restaurado anda igual ao original (diferença só da quantização)', () => {
    const orig = sim.createSim(refs(2, 0), DEFAULT_SHOOTER_OPTIONS, 9)
    const walk = (s: SimState, from: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const m = new Map<number, Input>()
        for (const p of s.players) m.set(p.slot, { seq: from + i + 1, mx: p.slot === 0 ? 1 : -0.6, my: p.slot === 0 ? 0.3 : 0.8, ax: 1, ay: 0, buttons: 0 })
        sim.step(s, m)
      }
    }
    walk(orig, 0, 60)
    const back = restoreState(decodeSnapshot(encodeSnapshot(snapshotFromState(orig, [], { epoch: 1, full: true })))!)
    const a = sim.cloneState(orig)
    walk(a, 60, 120)
    walk(back, 60, 120)
    for (const p of back.players) {
      const o = a.players.find((q) => q.slot === p.slot)!
      expect(Math.abs(p.x - o.x)).toBeLessThan(2)
      expect(Math.abs(p.y - o.y)).toBeLessThan(2)
    }
  })

  it('sem tabela de ids usa nomes de reserva', () => {
    const orig = sim.createSim(refs(1, 1), { ...DEFAULT_SHOOTER_OPTIONS, bots: 1 }, 1)
    const back = restoreState(decodeSnapshot(encodeSnapshot(snapshotFromState(orig, [], { epoch: 1 })))!, null)
    expect(back.players.map((p) => p.id)).toEqual(['jogador-0', 'bot-1'])
  })
})

describe('base64', () => {
  it('ida e volta com todos os tamanhos de resto', () => {
    const rnd = lcg(3)
    for (let n = 0; n < 40; n++) {
      const b = new Uint8Array(n).map(() => Math.floor(rnd() * 256))
      const text = toBase64(b)
      expect(new Uint8Array(fromBase64(text)!)).toEqual(b)
      expect(text).toBe(Buffer.from(b).toString('base64'))
    }
    expect(toBase64(new Uint8Array(4400)).length).toBe(Math.ceil(4400 / 3) * 4)
  })
  it('texto inválido dá null', () => {
    for (const bad of ['abc', 'ab!d', 'ab=d', '====', 'é', 'AA==AA==']) expect(fromBase64(bad)).toBeNull()
  })
})

describe('pacotes inválidos dão null (nunca lançam)', () => {
  const state = sim.createSim(refs(3, 1), { ...DEFAULT_SHOOTER_OPTIONS, bots: 1 }, 1)
  const good = [
    encodeHello('abc', 1),
    encodeInput(1, 0, [{ seq: 1, mx: 0, my: 0, ax: 1, ay: 0, buttons: 0 }]),
    encodePing(5),
    encodeSnapshot(snapshotFromState(state, [{ tick: 0, ev: { type: 'dash', slot: 0 } }], { epoch: 1, full: true }))
  ]

  it('vazio, 1 byte, tipo e versão desconhecidos', () => {
    expect(decodePacket(new ArrayBuffer(0))).toBeNull()
    expect(decodePacket(new Uint8Array([2]))).toBeNull()
    expect(decodePacket(new Uint8Array([99, 1, 0, 0]))).toBeNull()
    expect(decodePacket(new Uint8Array([2, 9, 0, 0]))).toBeNull()
    expect(decodePacket(new Uint8Array([0, 1]))).toBeNull()
  })

  it('cortado em qualquer ponto', () => {
    for (const g of good) {
      const bytes = new Uint8Array(g)
      for (let n = 0; n < bytes.length; n++) expect(decodePacket(bytes.slice(0, n))).toBeNull()
      expect(decodePacket(bytes)).not.toBeNull()
    }
  })

  it('com bytes sobrando', () => {
    for (const g of good) {
      const b = new Uint8Array(g.byteLength + 3)
      b.set(new Uint8Array(g))
      expect(decodePacket(b)).toBeNull()
    }
  })

  it('lixo aleatório e bytes corrompidos nunca lançam', () => {
    const rnd = lcg(42)
    for (let i = 0; i < 3000; i++) {
      const g = new Uint8Array(good[i % good.length])
      const b = g.slice()
      const flips = 1 + Math.floor(rnd() * 4)
      for (let k = 0; k < flips; k++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256)
      expect(() => decodePacket(b)).not.toThrow()
      const junk = new Uint8Array(Math.floor(rnd() * 80)).map(() => Math.floor(rnd() * 256))
      junk[0] = 1 + (i % 5)
      if (junk.length > 1) junk[1] = 1
      expect(() => decodePacket(junk)).not.toThrow()
    }
  })

  it('contagens absurdas no cabeçalho', () => {
    const g = new Uint8Array(good[3]).slice()
    const h = new DataView(g.buffer)
    h.setUint8(27, 200) // nPlayers
    expect(decodePacket(g)).toBeNull()
  })
})
