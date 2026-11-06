import { describe, expect, it, vi } from 'vitest'
import { MAX_CONTROL_BYTES, encodeControl, parseControl, parseHelper, type ControlMsg } from '../src/shared/control'
import { containRect, pickMonitor, toNormalized, wheelNotches } from '../src/web/control/geometry'
import { HelperClient } from '../src/web/control/helperClient'
import {
  INITIAL_CONTROL,
  reduce,
  type Ctx,
  type ControlEvent,
  type ControlState,
  type Effect
} from '../src/web/control/machine'

const ok = (msg: unknown) => parseControl(JSON.stringify(msg))

describe('contrato A (zod)', () => {
  it('aceita mensagens válidas', () => {
    const valid: ControlMsg[] = [
      { t: 'req' },
      { t: 'grant' },
      { t: 'deny', reason: 'nao-e-tela-inteira' },
      { t: 'end', by: 'panico' },
      { t: 'mm', x: 0, y: 1 },
      { t: 'md', b: 2 },
      { t: 'mu', b: 0 },
      { t: 'wh', dx: -10, dy: 10 },
      { t: 'kd', code: 'KeyA' },
      { t: 'ku', code: 'ShiftLeft' }
    ]
    for (const m of valid) expect(parseControl(encodeControl(m))).toEqual(m)
  })

  it('rejeita fora de faixa, tipos errados e campos extras de formato', () => {
    expect(ok({ t: 'mm', x: 1.01, y: 0.5 })).toBeNull()
    expect(ok({ t: 'mm', x: -0.1, y: 0.5 })).toBeNull()
    expect(ok({ t: 'mm', x: '0.5', y: 0.5 })).toBeNull()
    expect(ok({ t: 'md', b: 3 })).toBeNull()
    expect(ok({ t: 'wh', dx: 11, dy: 0 })).toBeNull()
    expect(ok({ t: 'wh', dx: 0.5, dy: 0 })).toBeNull()
    expect(ok({ t: 'kd', code: '' })).toBeNull()
    expect(ok({ t: 'kd', code: 'Key A' })).toBeNull()
    expect(ok({ t: 'deny', reason: 'qualquer' })).toBeNull()
    expect(ok({ t: 'end', by: 'outro' })).toBeNull()
    expect(ok({ t: 'desconhecido' })).toBeNull()
    expect(parseControl('{nao é json')).toBeNull()
    expect(parseControl(42)).toBeNull()
  })

  it('rejeita mensagens acima de 512 bytes', () => {
    const big = JSON.stringify({ t: 'kd', code: 'A'.repeat(32), pad: 'x'.repeat(MAX_CONTROL_BYTES) })
    expect(big.length).toBeGreaterThan(MAX_CONTROL_BYTES)
    expect(parseControl(big)).toBeNull()
    // 512 caracteres de 2 bytes passam do limite em bytes
    expect(parseControl(JSON.stringify({ t: 'req' }) + ' '.repeat(MAX_CONTROL_BYTES))).toBeNull()
  })
})

describe('contrato B (helper)', () => {
  it('valida mensagens do helper', () => {
    expect(parseHelper('{"type":"need-pair"}')).toEqual({ type: 'need-pair' })
    expect(parseHelper('{"type":"paired","token":""}')).toBeNull()
    expect(
      parseHelper('{"type":"ready","version":1,"monitors":[{"id":1,"x":0,"y":0,"w":1920,"h":1080,"primary":true}]}')
    ).not.toBeNull()
    expect(parseHelper('{"type":"ready","version":1,"monitors":[{"id":1}]}')).toBeNull()
    expect(parseHelper('lixo')).toBeNull()
  })
})

describe('coordenadas com object-fit: contain', () => {
  const box = { left: 100, top: 50, width: 800, height: 600 }

  it('tarjas laterais (vídeo mais alto que a caixa)', () => {
    // vídeo 4:3 numa caixa 4:3 menos larga? aqui vídeo 1:1 em 800x600: imagem 600x600 centrada
    const r = containRect(box, 1000, 1000)
    expect(r).toEqual({ left: 200, top: 50, width: 600, height: 600 })
    expect(toNormalized(200, 50, box, 1000, 1000)).toEqual({ x: 0, y: 0 })
    expect(toNormalized(800, 650, box, 1000, 1000)).toEqual({ x: 1, y: 1 })
    expect(toNormalized(500, 350, box, 1000, 1000)).toEqual({ x: 0.5, y: 0.5 })
    // dentro da tarja: encosta na borda
    expect(toNormalized(120, 350, box, 1000, 1000)).toEqual({ x: 0, y: 0.5 })
    expect(toNormalized(890, 350, box, 1000, 1000)).toEqual({ x: 1, y: 0.5 })
  })

  it('tarjas em cima e embaixo (vídeo mais largo que a caixa)', () => {
    // 16:9 em 800x600: imagem 800x450, tarjas de 75 em cima e embaixo
    const r = containRect(box, 1920, 1080)
    expect(r.left).toBe(100)
    expect(r.width).toBe(800)
    expect(r.height).toBe(450)
    expect(r.top).toBe(125)
    expect(toNormalized(100, 125, box, 1920, 1080)).toEqual({ x: 0, y: 0 })
    expect(toNormalized(500, 350, box, 1920, 1080)).toEqual({ x: 0.5, y: 0.5 })
    expect(toNormalized(500, 60, box, 1920, 1080)).toEqual({ x: 0.5, y: 0 })
    expect(toNormalized(500, 640, box, 1920, 1080)).toEqual({ x: 0.5, y: 1 })
  })

  it('sem tarjas quando a proporção é igual; sem tamanho de vídeo não envia', () => {
    expect(containRect(box, 800, 600)).toEqual(box)
    expect(toNormalized(300, 200, box, 0, 0)).toBeNull()
  })

  it('roda vira notches entre -10 e 10 e rolagem pequena não some', () => {
    expect(wheelNotches(100)).toBe(1)
    expect(wheelNotches(-300)).toBe(-3)
    expect(wheelNotches(4)).toBe(1)
    expect(wheelNotches(-4)).toBe(-1)
    expect(wheelNotches(5000)).toBe(10)
    expect(wheelNotches(0)).toBe(0)
    expect(wheelNotches(1, 1)).toBe(1) // linhas: 40 px, mínimo de 1 notch
  })
})

describe('escolha do monitor', () => {
  const m = (id: number, w: number, h: number, primary = false) => ({ id, x: 0, y: 0, w, h, primary })
  it('um monitor só', () => expect(pickMonitor([m(1, 1920, 1080, true)], 1280, 720)).toEqual({ monitor: 1, needsChoice: false }))
  it('tamanho igual ao do vídeo', () => {
    const list = [m(1, 1920, 1080, true), m(2, 2560, 1440)]
    expect(pickMonitor(list, 2560, 1440)).toEqual({ monitor: 2, needsChoice: false })
  })
  it('mesma proporção quando só um bate (captura reduzida)', () => {
    const list = [m(1, 1920, 1080, true), m(2, 1280, 1024)]
    expect(pickMonitor(list, 1280, 720)).toEqual({ monitor: 1, needsChoice: false })
  })
  it('nada bate com vários monitores: primário e pede escolha', () => {
    const list = [m(1, 1920, 1080), m(2, 1920, 1080, true)]
    expect(pickMonitor(list, 1280, 720)).toEqual({ monitor: 2, needsChoice: true })
    expect(pickMonitor(list)).toEqual({ monitor: 2, needsChoice: true })
  })
  it('sem monitores', () => expect(pickMonitor([])).toEqual({ needsChoice: false }))
})

describe('máquina de estados', () => {
  const GOOD: Ctx = { sharing: true, fullScreen: true, helperReady: true }
  const run = (state: ControlState, ...events: ControlEvent[]) => {
    let s = state
    const effects: Effect[] = []
    for (const ev of events) {
      const step = reduce(s, ev)
      s = step.state
      effects.push(...step.effects)
    }
    return { s, effects }
  }
  const msg = (from: string, m: ControlMsg, ctx: Ctx = GOOD): ControlEvent => ({ k: 'msg', from, msg: m, ctx })
  const sent = (fx: Effect[]) => fx.filter((e): e is Extract<Effect, { e: 'send' }> => e.e === 'send').map((e) => e.msg)

  // controlado ativo com "bia"
  const active = run(INITIAL_CONTROL, msg('bia', { t: 'req' }), { k: 'allow', ctx: GOOD, monitor: 2 }).s

  it('fluxo feliz do controlador: pedido, grant, ativo, soltar', () => {
    const a = run(INITIAL_CONTROL, { k: 'request', peer: 'pedro' })
    expect(a.s.controller).toEqual({ phase: 'pending', peer: 'pedro' })
    expect(sent(a.effects)).toEqual([{ t: 'req' }])
    const b = run(a.s, msg('pedro', { t: 'grant' }))
    expect(b.s.controller).toEqual({ phase: 'active', peer: 'pedro' })
    const c = run(b.s, { k: 'release' })
    expect(c.s.controller.phase).toBe('idle')
    expect(sent(c.effects)).toEqual([{ t: 'end', by: 'controlador' }])
  })

  it('grant sem req é ignorado (e de outro peer também)', () => {
    expect(run(INITIAL_CONTROL, msg('pedro', { t: 'grant' })).s).toEqual(INITIAL_CONTROL)
    const pending = run(INITIAL_CONTROL, { k: 'request', peer: 'pedro' }).s
    expect(run(pending, msg('caio', { t: 'grant' })).s.controller).toEqual({ phase: 'pending', peer: 'pedro' })
  })

  it('deny volta a idle com aviso; deny sem pedido é ignorado', () => {
    const pending = run(INITIAL_CONTROL, { k: 'request', peer: 'pedro' }).s
    const d = run(pending, msg('pedro', { t: 'deny', reason: 'sem-helper' }))
    expect(d.s.controller.phase).toBe('idle')
    expect(d.effects).toContainEqual({ e: 'notice', code: 'negado', peer: 'pedro', reason: 'sem-helper' })
    expect(run(INITIAL_CONTROL, msg('pedro', { t: 'deny', reason: 'recusado' })).effects).toEqual([])
  })

  it('input sem sessão é descartado', () => {
    expect(run(INITIAL_CONTROL, msg('bia', { t: 'mm', x: 0.5, y: 0.5 })).effects).toEqual([])
    const asking = run(INITIAL_CONTROL, msg('bia', { t: 'req' })).s
    expect(asking.controlled.phase).toBe('asking')
    expect(run(asking, msg('bia', { t: 'kd', code: 'KeyA' })).effects).toEqual([]) // pedido ainda não permitido
  })

  it('input só passa para o helper vindo do peer com sessão ativa', () => {
    expect(active.controlled).toEqual({ phase: 'active', peer: 'bia' })
    expect(run(active, msg('bia', { t: 'kd', code: 'KeyA' })).effects).toEqual([
      { e: 'helper-input', msg: { t: 'kd', code: 'KeyA' } }
    ])
    expect(run(active, msg('caio', { t: 'kd', code: 'KeyA' })).effects).toEqual([])
  })

  it('pedido: sem tela inteira é negado sem abrir modal; ocupado também', () => {
    const w = run(INITIAL_CONTROL, msg('bia', { t: 'req' }, { ...GOOD, fullScreen: false }))
    expect(w.s.controlled.phase).toBe('idle')
    expect(sent(w.effects)).toEqual([{ t: 'deny', reason: 'nao-e-tela-inteira' }])
    const n = run(INITIAL_CONTROL, msg('bia', { t: 'req' }, { ...GOOD, sharing: false }))
    expect(sent(n.effects)).toEqual([{ t: 'deny', reason: 'nao-e-tela-inteira' }])
    const busy = run(active, msg('caio', { t: 'req' }))
    expect(busy.s).toEqual(active)
    expect(sent(busy.effects)).toEqual([{ t: 'deny', reason: 'ocupado' }])
  })

  it('permitir abre sessão no helper e manda grant; sem helper ou sem tela inteira vira deny', () => {
    const asking = run(INITIAL_CONTROL, msg('bia', { t: 'req' })).s
    const a = run(asking, { k: 'allow', ctx: GOOD, monitor: 3 })
    expect(a.effects).toEqual([
      { e: 'helper-session', active: true, peer: 'bia', monitor: 3 },
      { e: 'send', to: 'bia', msg: { t: 'grant' } }
    ])
    const noHelper = run(asking, { k: 'allow', ctx: { ...GOOD, helperReady: false } })
    expect(noHelper.s.controlled.phase).toBe('idle')
    expect(sent(noHelper.effects)).toEqual([{ t: 'deny', reason: 'sem-helper' }])
    const noScreen = run(asking, { k: 'allow', ctx: { ...GOOD, fullScreen: false } })
    expect(sent(noScreen.effects)).toEqual([{ t: 'deny', reason: 'nao-e-tela-inteira' }])
    // allow sem pedido não faz nada
    expect(run(INITIAL_CONTROL, { k: 'allow', ctx: GOOD }).effects).toEqual([])
  })

  it('recusar manda deny recusado', () => {
    const asking = run(INITIAL_CONTROL, msg('bia', { t: 'req' })).s
    const r = run(asking, { k: 'refuse' })
    expect(r.s.controlled.phase).toBe('idle')
    expect(sent(r.effects)).toEqual([{ t: 'deny', reason: 'recusado' }])
  })

  const ends: [string, ControlEvent][] = [
    ['Parar no banner', { k: 'stop', by: 'controlado' }],
    ['pânico do helper', { k: 'stop', by: 'panico' }],
    ['tela parou ou deixou de ser inteira', { k: 'unsafe-screen', sharing: false }],
    ['helper caiu', { k: 'helper-lost' }],
    ['controlador saiu ou perdeu a conexão', { k: 'peer-gone', peer: 'bia' }],
    ['controlador mandou end', msg('bia', { t: 'end', by: 'controlador' })],
    ['sair da sala', { k: 'reset' }]
  ]
  for (const [name, ev] of ends) {
    it(`encerra a sessão ativa: ${name}`, () => {
      const r = run(active, ev)
      expect(r.s).toEqual(INITIAL_CONTROL)
      expect(r.effects).toContainEqual({ e: 'helper-session', active: false })
      // e depois disso nenhum input passa
      expect(run(r.s, msg('bia', { t: 'mm', x: 0.1, y: 0.1 })).effects).toEqual([])
    })
  }

  it('parar e pânico avisam o controlador com o motivo certo', () => {
    expect(sent(run(active, { k: 'stop', by: 'panico' }).effects)).toEqual([{ t: 'end', by: 'panico' }])
    expect(sent(run(active, { k: 'stop', by: 'controlado' }).effects)).toEqual([{ t: 'end', by: 'controlado' }])
  })

  it('end do controlado encerra o lado do controlador', () => {
    const ctl = run(INITIAL_CONTROL, { k: 'request', peer: 'pedro' }, msg('pedro', { t: 'grant' })).s
    const r = run(ctl, msg('pedro', { t: 'end', by: 'panico' }))
    expect(r.s.controller.phase).toBe('idle')
    expect(r.effects).toContainEqual({ e: 'notice', code: 'encerrado-panico', peer: 'pedro' })
    // end de quem não é o par é ignorado
    expect(run(ctl, msg('caio', { t: 'end', by: 'controlado' })).s).toEqual(ctl)
  })

  it('pedidos expiram em ambos os papéis', () => {
    const pending = run(INITIAL_CONTROL, { k: 'request', peer: 'pedro' }).s
    const t = run(pending, { k: 'timeout', role: 'controller', peer: 'pedro' })
    expect(t.s.controller.phase).toBe('idle')
    expect(sent(t.effects)).toEqual([{ t: 'end', by: 'controlador' }])
    expect(run(pending, { k: 'timeout', role: 'controller', peer: 'outro' }).s).toEqual(pending)
    const asking = run(INITIAL_CONTROL, msg('bia', { t: 'req' })).s
    const e = run(asking, { k: 'timeout', role: 'controlled', peer: 'bia' })
    expect(e.s.controlled.phase).toBe('idle')
    expect(sent(e.effects)).toEqual([{ t: 'deny', reason: 'recusado' }])
    // timeout não derruba sessão ativa
    expect(run(active, { k: 'timeout', role: 'controlled', peer: 'bia' }).s).toEqual(active)
  })

  it('pedido pendente some quando o controlador cancela (modal fecha)', () => {
    const asking = run(INITIAL_CONTROL, msg('bia', { t: 'req' })).s
    expect(run(asking, msg('bia', { t: 'end', by: 'controlador' })).s.controlled.phase).toBe('idle')
  })

  it('só um pedido por vez como controlador', () => {
    const pending = run(INITIAL_CONTROL, { k: 'request', peer: 'pedro' }).s
    const again = run(pending, { k: 'request', peer: 'caio' })
    expect(again.s).toEqual(pending)
    expect(again.effects).toEqual([])
  })
})

describe('helperClient', () => {
  class FakeWs {
    static all: FakeWs[] = []
    readyState = 0
    sent: unknown[] = []
    onopen: (() => void) | null = null
    onmessage: ((e: { data: unknown }) => void) | null = null
    onerror: (() => void) | null = null
    onclose: (() => void) | null = null
    constructor(public url: string) {
      FakeWs.all.push(this)
    }
    send(d: string) {
      this.sent.push(JSON.parse(d))
    }
    close() {
      this.readyState = 3
    }
    open() {
      this.readyState = 1
      this.onopen?.()
    }
    say(m: unknown) {
      this.onmessage?.({ data: JSON.stringify(m) })
    }
    drop() {
      this.readyState = 3
      this.onclose?.()
    }
  }
  const READY = { type: 'ready', version: 1, monitors: [{ id: 1, x: 0, y: 0, w: 1920, h: 1080, primary: true }] }

  const make = (token?: string) => {
    FakeWs.all = []
    let stored = token
    const client = new HelperClient({
      makeSocket: (u) => new FakeWs(u) as unknown as WebSocket,
      getToken: () => stored,
      setToken: (t) => (stored = t),
      backoffMs: [1000, 2000]
    })
    return { client, token: () => stored, ws: () => FakeWs.all[FakeWs.all.length - 1] }
  }

  it('não conecta até start()', () => {
    const { client } = make()
    expect(client.snapshot.status).toBe('desligado')
    expect(FakeWs.all).toHaveLength(0)
  })

  it('pareia: need-pair, código, paired guarda token, ready', () => {
    const { client, ws, token } = make()
    client.start()
    expect(client.snapshot.status).toBe('procurando')
    ws().open()
    expect(ws().sent[0]).toEqual({ type: 'hello', version: 1 })
    ws().say({ type: 'need-pair' })
    expect(client.snapshot.status).toBe('precisa-parear')
    expect(client.pair('12')).toBe(false)
    expect(client.pair('123456')).toBe(true)
    expect(ws().sent[1]).toEqual({ type: 'pair', code: '123456' })
    ws().say({ type: 'paired', token: 'tok' })
    expect(token()).toBe('tok')
    ws().say(READY)
    expect(client.snapshot.status).toBe('pronto')
    expect(client.snapshot.monitors).toHaveLength(1)
  })

  it('usa o token salvo no hello e descarta token recusado', () => {
    const { client, ws, token } = make('antigo')
    client.start()
    ws().open()
    expect(ws().sent[0]).toEqual({ type: 'hello', token: 'antigo', version: 1 })
    ws().say({ type: 'need-pair' })
    expect(token()).toBeUndefined()
  })

  it('input e sessão só vão com o helper pronto; pânico avisa quem escuta', () => {
    const { client, ws } = make()
    const panic = vi.fn()
    client.onPanic(panic)
    client.start()
    ws().open()
    client.sendInput({ t: 'kd', code: 'KeyA' })
    client.setSession(true, 1, 'Bia')
    expect(ws().sent).toHaveLength(1) // só o hello
    ws().say(READY)
    client.setSession(true, 1, 'Bia')
    client.sendInput({ t: 'kd', code: 'KeyA' })
    expect(ws().sent.slice(1)).toEqual([
      { type: 'session', active: true, monitor: 1, peerName: 'Bia' },
      { type: 'input', ev: { t: 'kd', code: 'KeyA' } }
    ])
    ws().say({ type: 'panic' })
    expect(panic).toHaveBeenCalledTimes(1)
  })

  it('ignora lixo do helper', () => {
    const { client, ws } = make()
    client.start()
    ws().open()
    ws().onmessage?.({ data: 'não é json' })
    ws().say({ type: 'ready', monitors: 'x' })
    expect(client.snapshot.status).toBe('procurando')
  })

  it('reconecta com backoff enquanto quiser, e para no stop()', () => {
    vi.useFakeTimers()
    try {
      const { client, ws } = make()
      client.start()
      ws().drop() // nunca abriu: helper ausente
      expect(client.snapshot.status).toBe('erro')
      expect(FakeWs.all).toHaveLength(1)
      vi.advanceTimersByTime(999)
      expect(FakeWs.all).toHaveLength(1)
      vi.advanceTimersByTime(1)
      expect(FakeWs.all).toHaveLength(2)
      ws().drop()
      vi.advanceTimersByTime(1999)
      expect(FakeWs.all).toHaveLength(2)
      vi.advanceTimersByTime(1)
      expect(FakeWs.all).toHaveLength(3)
      ws().open()
      ws().say(READY)
      expect(client.snapshot.status).toBe('pronto')
      ws().drop() // caiu depois de conectado
      expect(client.snapshot.status).toBe('procurando')
      client.stop()
      expect(client.snapshot.status).toBe('desligado')
      vi.advanceTimersByTime(60_000)
      expect(FakeWs.all).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
