import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { DenyReason, InputMsg } from '../../shared/control'
import type { PeerManager, PeerView } from '../rtc/PeerManager'
import { getHelperToken, setHelperToken } from '../storage'
import { HelperClient, type HelperSnapshot } from './helperClient'
import { INITIAL_CONTROL, reduce, type ControlEvent, type ControlState, type Effect, type NoticeCode } from './machine'

export const CONTROL_REQUEST_TIMEOUT_MS = 30_000
const SURFACE_POLL_MS = 1000

export type ToastKind = 'ok' | 'info' | 'warn' | 'error'

const DENY_TEXT: Record<DenyReason, string> = {
  recusado: 'recusou o controle',
  'sem-helper': 'não tem o JanJa Helper rodando',
  'nao-e-tela-inteira': 'não está compartilhando a tela inteira',
  ocupado: 'já está sendo controlado por outra pessoa'
}

function noticeText(code: NoticeCode, name: string, reason?: DenyReason): [string, ToastKind] {
  switch (code) {
    case 'negado':
      return [`${name} ${reason ? DENY_TEXT[reason] : 'negou o controle'}`, 'warn']
    case 'encerrado-pelo-controlador':
      return [`${name} parou de controlar seu PC`, 'info']
    case 'encerrado-pelo-controlado':
      return [`${name} encerrou o controle`, 'info']
    case 'encerrado-panico':
      return [`${name} cortou o controle (atalho de pânico)`, 'warn']
    case 'sem-resposta':
      return [`${name} não respondeu ao pedido`, 'warn']
    case 'perdido':
      return [`O controle com ${name} acabou porque a conexão caiu`, 'warn']
  }
}

/** A tela local é o monitor inteiro? */
export function isWholeScreen(stream: MediaStream | undefined): boolean {
  const track = stream?.getVideoTracks()[0]
  if (!track || track.readyState !== 'live') return false
  return (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface === 'monitor'
}

interface Options {
  manager?: PeerManager
  /** minha tela compartilhada */
  screen?: MediaStream
  peers: PeerView[]
  notify: (text: string, kind: ToastKind) => void
}

/**
 * Controle remoto: junta o canal P2P "control", o helper local e a máquina de estados.
 * Todo caminho de encerramento (parar, pânico, sair, perder conexão, parar a tela) passa pela máquina.
 */
export function useControl({ manager, screen, peers, notify }: Options) {
  const helper = useMemo(
    () => new HelperClient({ getToken: getHelperToken, setToken: setHelperToken }),
    []
  )
  const helperSnap = useSyncExternalStore(
    useCallback((cb) => helper.onChange(cb), [helper]),
    () => helper.snapshot
  )

  const [state, setState] = useState<ControlState>(INITIAL_CONTROL)
  const stateRef = useRef(state)
  const optsRef = useRef({ manager, screen, peers, notify })
  optsRef.current = { manager, screen, peers, notify }

  const ctx = useCallback(() => {
    const { screen: s } = optsRef.current
    return { sharing: !!s, fullScreen: isWholeScreen(s), helperReady: helper.ready }
  }, [helper])

  const run = useCallback(
    (effects: Effect[]) => {
      const { manager: m, peers: ps, notify: say } = optsRef.current
      const nameOf = (id: string) => ps.find((p) => p.id === id)?.name ?? 'Alguém'
      for (const fx of effects) {
        switch (fx.e) {
          case 'send':
            m?.sendControl(fx.to, fx.msg)
            break
          case 'helper-session':
            helper.setSession(fx.active, fx.monitor, fx.peer ? nameOf(fx.peer) : undefined)
            break
          case 'helper-input':
            helper.sendInput(fx.msg)
            break
          case 'notice': {
            const [text, kind] = noticeText(fx.code, nameOf(fx.peer), fx.reason)
            say(text, kind)
            break
          }
        }
      }
    },
    [helper]
  )

  const dispatch = useCallback(
    (ev: ControlEvent) => {
      const step = reduce(stateRef.current, ev)
      if (step.state !== stateRef.current) {
        stateRef.current = step.state
        setState(step.state)
      }
      run(step.effects)
    },
    [run]
  )

  // mensagens do canal P2P e conexões perdidas
  useEffect(() => {
    if (!manager) return
    const offMsg = manager.onControl((from, msg) => dispatch({ k: 'msg', from, msg, ctx: ctx() }))
    const offLost = manager.onControlLost((peer) => dispatch({ k: 'peer-gone', peer }))
    return () => {
      offMsg()
      offLost()
      dispatch({ k: 'reset' })
    }
  }, [manager, dispatch, ctx])

  // pânico do helper e perda do helper
  useEffect(() => helper.onPanic(() => dispatch({ k: 'stop', by: 'panico' })), [helper, dispatch])
  useEffect(() => {
    if (helperSnap.status !== 'pronto') dispatch({ k: 'helper-lost' })
  }, [helperSnap.status, dispatch])

  // sair da sala solta o helper
  useEffect(() => () => helper.stop(), [helper])

  // quem eu controlo/peço sumiu da sala ou parou de compartilhar
  const { controller, controlled } = state
  useEffect(() => {
    if (controller.phase === 'idle') return
    const peer = peers.find((p) => p.id === controller.peer)
    if (!peer) dispatch({ k: 'peer-gone', peer: controller.peer })
    else if (!peer.screen && controller.phase === 'active') dispatch({ k: 'release' })
  }, [peers, controller, dispatch])

  // a minha tela deve continuar sendo a tela inteira enquanto alguém pede ou controla
  const busy = controlled.phase !== 'idle'
  useEffect(() => {
    if (!busy) return
    const check = () => {
      const s = optsRef.current.screen
      if (!isWholeScreen(s)) dispatch({ k: 'unsafe-screen', sharing: false })
    }
    check()
    const timer = window.setInterval(check, SURFACE_POLL_MS)
    return () => window.clearInterval(timer)
  }, [busy, screen, dispatch])

  // pedidos expiram em 30 s, nos dois papéis
  const controllerPeer = controller.phase === 'pending' ? controller.peer : undefined
  useEffect(() => {
    if (!controllerPeer) return
    const t = window.setTimeout(() => dispatch({ k: 'timeout', role: 'controller', peer: controllerPeer }), CONTROL_REQUEST_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [controllerPeer, dispatch])
  const askingPeer = controlled.phase === 'asking' ? controlled.peer : undefined
  useEffect(() => {
    if (!askingPeer) return
    const t = window.setTimeout(() => dispatch({ k: 'timeout', role: 'controlled', peer: askingPeer }), CONTROL_REQUEST_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [askingPeer, dispatch])

  // ---------------- ações da UI ----------------

  const requestControl = useCallback((peer: string) => dispatch({ k: 'request', peer }), [dispatch])
  const release = useCallback(() => dispatch({ k: 'release' }), [dispatch])
  const allow = useCallback((monitor?: number) => dispatch({ k: 'allow', ctx: ctx(), monitor }), [dispatch, ctx])
  const refuse = useCallback(() => dispatch({ k: 'refuse' }), [dispatch])
  const stop = useCallback(() => dispatch({ k: 'stop', by: 'controlado' }), [dispatch])

  const sendInput = useCallback((msg: InputMsg) => {
    const s = stateRef.current.controller
    if (s.phase === 'active') optsRef.current.manager?.sendControl(s.peer, msg)
  }, [])

  const connectHelper = useCallback(() => helper.start(), [helper])
  const disconnectHelper = useCallback(() => helper.stop(), [helper])
  const pairHelper = useCallback((code: string) => helper.pair(code), [helper])

  return {
    controller,
    controlled,
    helper: helperSnap as HelperSnapshot,
    requestControl,
    release,
    allow,
    refuse,
    stop,
    sendInput,
    connectHelper,
    disconnectHelper,
    pairHelper
  }
}

export type ControlApi = ReturnType<typeof useControl>
