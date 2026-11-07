import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { PokerScene } from '../scene/PokerScene'
import type { Rect, SceneLayout } from '../contract'
import * as F from './fakes'

const SIZES: Record<string, [number, number]> = {
  '1920x1080': [1920, 1080],
  '1280x720': [1280, 720],
  '3440x1440 ultrawide': [3440, 1440],
  '2560x1080 ultrawide': [2560, 1080],
  '390x844 celular': [390, 844],
  'faixa 1920x330': [1920, 330]
}

/** Laboratório da mesa (só em dev): view de mentira e um botão para cada evento. Rota /dev/poker. */
export function SceneLab(): ReactElement {
  const q = new URLSearchParams(location.search)
  const [n, setN] = useState(Number(q.get('n') ?? 4))
  const [mode, setMode] = useState<'holdem' | 'tres'>('holdem')
  const [state, setState] = useState(() => F.initial(Number(q.get('n') ?? 4)))
  const [size, setSize] = useState(q.get('size') ?? '1920x1080')
  const [tvCount, setTv] = useState(Number(q.get('tv') ?? 1))
  const [layout, setLayout] = useState<SceneLayout>((q.get('layout') as SceneLayout) ?? 'mesa')
  const [reduced, setReduced] = useState(q.get('reduced') === '1')
  const [spectator, setSpectator] = useState(false)
  const [rects, setRects] = useState<Rect[]>([])
  const ref = useRef(state)
  ref.current = state
  const parseSize = (v: string): [number, number] => {
    const m = /^(\d+)x(\d+)/.exec(v)
    return SIZES[v] ?? (m ? [+m[1], +m[2]] : [1920, 1080])
  }
  const [wh, setWh] = useState<[number, number]>(parseSize(size))
  useEffect(() => setWh(parseSize(size)), [size])

  const apply = (f: (s: F.FakeState) => F.FakeState) => setState((s) => f(s))
  useEffect(() => {
    const lab = {
      reset: (k = n) => setState(F.initial(k, mode)),
      newHand: () => apply(F.newHand),
      act: (a: Parameters<typeof F.act>[1]) => apply((s) => F.act(s, a)),
      flop: () => apply(F.flop),
      turn: () => apply(F.turn),
      river: () => apply(F.river),
      showdown: () => apply(F.showdown),
      rebuy: () => apply(F.rebuy),
      timeout: () => apply(F.timeout),
      end: () => apply(F.end)
    }
    ;(window as unknown as { __lab: typeof lab }).__lab = lab
  })

  const view = useMemo(() => F.toView(state, spectator ? null : 'p0'), [state, spectator])
  const colors = useMemo(() => F.colorMap(state.n), [state.n])
  const btn = (label: string, fn: () => void, id: string) => (
    <button key={id} data-act={id} onClick={fn} style={{ font: '12px system-ui', padding: '4px 8px', margin: 2, cursor: 'pointer' }}>
      {label}
    </button>
  )
  return (
    <div style={{ background: '#15100d', color: '#F3EBDD', minHeight: '100vh', font: '12px system-ui', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        <label>
          jogadores{' '}
          <select value={n} onChange={(e) => { setN(+e.target.value); setState(F.initial(+e.target.value, mode)) }}>
            {[2, 3, 4, 5, 6, 7, 8].map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>
        <label>
          tamanho{' '}
          <select value={size} onChange={(e) => setSize(e.target.value)}>
            {[...new Set([size, ...Object.keys(SIZES)])].map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>
        <label>
          TVs <input type="number" min={0} max={8} value={tvCount} onChange={(e) => setTv(+e.target.value)} style={{ width: 40 }} />
        </label>
        <label>
          layout{' '}
          <select value={layout} onChange={(e) => setLayout(e.target.value as SceneLayout)}>
            <option>mesa</option>
            <option>faixa</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> movimento reduzido
        </label>
        <label>
          <input type="checkbox" checked={spectator} onChange={(e) => setSpectator(e.target.checked)} /> espectador
        </label>
        <label>
          <input type="checkbox" checked={mode === 'tres'} onChange={(e) => { const m = e.target.checked ? 'tres' : 'holdem'; setMode(m); setState(F.initial(n, m)) }} /> 3 cartas
        </label>
        {btn('Nova mão', () => apply(F.newHand), 'new')}
        {btn('Passar', () => apply((s) => F.act(s, 'check')), 'check')}
        {btn('Pagar', () => apply((s) => F.act(s, 'call')), 'call')}
        {btn('Aumentar', () => apply((s) => F.act(s, 'raise')), 'raise')}
        {btn('Desistir', () => apply((s) => F.act(s, 'fold')), 'fold')}
        {btn('Tudo', () => apply((s) => F.act(s, 'allin')), 'allin')}
        {btn('Flop', () => apply(F.flop), 'flop')}
        {btn('Turn', () => apply(F.turn), 'turn')}
        {btn('River', () => apply(F.river), 'river')}
        {btn('Showdown', () => apply(F.showdown), 'showdown')}
        {btn('Recompra', () => apply(F.rebuy), 'rebuy')}
        {btn('Tempo', () => apply(F.timeout), 'timeout')}
        {btn('Fim', () => apply(F.end), 'end')}
        {btn('Zerar', () => setState(F.initial(n, mode)), 'reset')}
        <span style={{ opacity: 0.6 }}>TVs: {rects.length}</span>
      </div>
      <div style={{ position: 'relative', width: wh[0], height: wh[1], margin: '0 auto', outline: '1px dashed #555', overflow: 'hidden' }} data-stage>
        <PokerScene view={view} lastEvents={state.lastEvents} me={spectator ? null : 'p0'} colors={colors} tvCount={tvCount} layout={layout} reducedMotion={reduced} onTvRects={setRects} />
        {rects.map((r, i) => (
          <div key={i} style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, display: 'grid', placeItems: 'center', color: '#FFC94A', font: '14px system-ui', pointerEvents: 'none', background: '#1d3347' }}>
            tela {i + 1}
          </div>
        ))}
      </div>
    </div>
  )
}
