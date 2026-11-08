import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOG_SIZE, type DiagEvent, type DiagKind } from '../src/web/rtc/diag'
import { DIAG_COLORS, DiagLog, clockOf, consoleLine } from '../src/web/rtc/diagLog'

const KINDS: DiagKind[] = ['up', 'down', 'perda', 'travada', 'cpu', 'banda', 'relay', 'direto', 'tela', 'info']

describe('diário de eventos', () => {
  afterEach(() => vi.restoreAllMocks())

  it('guarda do mais antigo para o mais novo, com ids crescentes', () => {
    const log = new DiagLog({ echo: false })
    log.push({ kind: 'info', text: 'a', at: 1 })
    log.push({ kind: 'up', text: 'b', who: 'Bia', at: 2 })
    expect(log.list().map((e) => [e.id, e.text, e.at])).toEqual([
      [1, 'a', 1],
      [2, 'b', 2]
    ])
    expect(log.list()[1].who).toBe('Bia')
    expect('who' in log.list()[0]).toBe(false)
  })

  it('anel: passa de LOG_SIZE e descarta os mais antigos', () => {
    const log = new DiagLog({ echo: false })
    for (let i = 0; i < LOG_SIZE + 10; i++) log.push({ kind: 'info', text: `e${i}`, at: i })
    const list = log.list()
    expect(list).toHaveLength(LOG_SIZE)
    expect(list[0].text).toBe('e10')
    expect(list.at(-1)?.id).toBe(LOG_SIZE + 10)
  })

  it('list devolve cópia; clear esvazia mas os ids continuam subindo', () => {
    const log = new DiagLog({ echo: false })
    log.push({ kind: 'info', text: 'a', at: 1 })
    log.list().pop()
    expect(log.list()).toHaveLength(1)
    log.clear()
    expect(log.list()).toEqual([])
    log.push({ kind: 'info', text: 'b', at: 2 })
    expect(log.list()[0].id).toBe(2)
  })

  it('onChange avisa em push e clear e dá para cancelar', () => {
    const log = new DiagLog({ echo: false })
    const cb = vi.fn()
    const off = log.onChange(cb)
    log.push({ kind: 'info', text: 'a', at: 1 })
    log.clear()
    expect(cb).toHaveBeenCalledTimes(2)
    off()
    log.push({ kind: 'info', text: 'b', at: 2 })
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('sem "at" usa o relógio; cada push vai para o console.info', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const log = new DiagLog({ clock: () => 42 })
    log.push({ kind: 'down', text: 'Qualidade desceu para 720p 30: upload no limite' })
    expect(log.list()[0].at).toBe(42)
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toContain('%c')
  })

  it('consoleLine: selo JanJa, selo do tipo, hora e texto, sem emoji', () => {
    const e: DiagEvent = { id: 1, at: new Date(2026, 0, 2, 3, 4, 5).getTime(), kind: 'perda', text: 'Perdendo 100% dos pacotes' }
    const [fmt, ...args] = consoleLine(e)
    expect(fmt.match(/%c/g)).toHaveLength(4)
    expect(fmt).toContain('JanJa')
    expect(fmt).toContain('perda')
    expect(args).toHaveLength(6)
    expect(args[0]).toContain('#FFC94A')
    expect(args[2]).toContain(DIAG_COLORS.perda)
    expect(args[4]).toBe('03:04:05')
    expect(args[5]).toBe('Perdendo 100% dos pacotes')
    expect(/\p{Extended_Pictographic}/u.test([fmt, ...args].join(' '))).toBe(false)
  })

  it('toda categoria tem cor da paleta e a hora tem 8 caracteres', () => {
    const palette = ['#6FD49B', '#FF7A6B', '#FFC94A', '#F3EBDD', '#B7A99A']
    for (const k of KINDS) {
      expect(palette).toContain(DIAG_COLORS[k])
      expect(consoleLine({ id: 1, at: 0, kind: k, text: 'x' })[0]).toMatch(/^%cJanJa%c %c/)
    }
    expect(clockOf(new Date(2026, 5, 1, 23, 59, 9).getTime())).toBe('23:59:09')
  })
})
