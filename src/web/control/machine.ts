import { isInputMsg, type ControlMsg, type DenyReason, type EndBy, type InputMsg } from '../../shared/control'

/**
 * Máquina de estados do controle remoto, pura (sem React, sem rede), para testar todos os casos.
 * Cada pessoa tem dois papéis independentes: controlador (pede e manda input) e controlado (consente).
 */

export type ControllerState = { phase: 'idle' } | { phase: 'pending'; peer: string } | { phase: 'active'; peer: string }
export type ControlledState = { phase: 'idle' } | { phase: 'asking'; peer: string } | { phase: 'active'; peer: string }

export interface ControlState {
  controller: ControllerState
  controlled: ControlledState
}

export const INITIAL_CONTROL: ControlState = { controller: { phase: 'idle' }, controlled: { phase: 'idle' } }

/** Fatos do momento, lidos pelo chamador no instante do evento. */
export interface Ctx {
  /** estou compartilhando a tela */
  sharing: boolean
  /** a tela compartilhada é o monitor inteiro (displaySurface === 'monitor') */
  fullScreen: boolean
  /** o helper está conectado, pareado e pronto */
  helperReady: boolean
}

export type ControlEvent =
  | { k: 'msg'; from: string; msg: ControlMsg; ctx: Ctx }
  | { k: 'request'; peer: string }
  /** controlador: cancela o pedido ou solta o controle */
  | { k: 'release' }
  | { k: 'allow'; ctx: Ctx; monitor?: number }
  | { k: 'refuse' }
  /** controlado: Parar no banner (controlado) ou atalho do helper (panico) */
  | { k: 'stop'; by: 'controlado' | 'panico' }
  | { k: 'peer-gone'; peer: string }
  | { k: 'unsafe-screen'; sharing: boolean }
  | { k: 'helper-lost' }
  | { k: 'timeout'; role: 'controller' | 'controlled'; peer: string }
  | { k: 'reset' }

export type NoticeCode =
  | 'negado'
  | 'encerrado-pelo-controlador'
  | 'encerrado-pelo-controlado'
  | 'encerrado-panico'
  | 'sem-resposta'
  | 'perdido'

export type Effect =
  | { e: 'send'; to: string; msg: ControlMsg }
  | { e: 'helper-session'; active: boolean; peer?: string; monitor?: number }
  | { e: 'helper-input'; msg: InputMsg }
  | { e: 'notice'; code: NoticeCode; peer: string; reason?: DenyReason }

export interface Step {
  state: ControlState
  effects: Effect[]
}

const same = (s: ControlState, effects: Effect[] = []): Step => ({ state: s, effects })

/** Encerra o papel de controlado (se houver), avisando o helper quando a sessão estava ativa. */
function endControlled(s: ControlState, effects: Effect[]): ControlState {
  if (s.controlled.phase === 'active') effects.push({ e: 'helper-session', active: false })
  return { ...s, controlled: { phase: 'idle' } }
}

const endMsg = (by: EndBy): ControlMsg => ({ t: 'end', by })

export function reduce(s: ControlState, ev: ControlEvent): Step {
  const effects: Effect[] = []
  switch (ev.k) {
    case 'msg': {
      const { from, msg, ctx } = ev
      if (isInputMsg(msg)) {
        // input só vale com sessão ativa COM aquele peer
        if (s.controlled.phase === 'active' && s.controlled.peer === from) {
          return same(s, [{ e: 'helper-input', msg }])
        }
        return same(s)
      }
      switch (msg.t) {
        case 'req': {
          if (s.controlled.phase !== 'idle') {
            if (s.controlled.peer === from && s.controlled.phase === 'asking') return same(s) // pedido repetido
            return same(s, [{ e: 'send', to: from, msg: { t: 'deny', reason: 'ocupado' } }])
          }
          if (!ctx.sharing || !ctx.fullScreen) {
            return same(s, [{ e: 'send', to: from, msg: { t: 'deny', reason: 'nao-e-tela-inteira' } }])
          }
          return same({ ...s, controlled: { phase: 'asking', peer: from } })
        }
        case 'grant': {
          if (s.controller.phase === 'pending' && s.controller.peer === from) {
            return same({ ...s, controller: { phase: 'active', peer: from } })
          }
          return same(s) // grant sem pedido: ignorado
        }
        case 'deny': {
          if (s.controller.phase === 'pending' && s.controller.peer === from) {
            return same({ ...s, controller: { phase: 'idle' } }, [
              { e: 'notice', code: 'negado', peer: from, reason: msg.reason }
            ])
          }
          return same(s)
        }
        case 'end': {
          let next = s
          if (s.controller.phase !== 'idle' && s.controller.peer === from) {
            next = { ...next, controller: { phase: 'idle' } }
            effects.push({
              e: 'notice',
              code: msg.by === 'panico' ? 'encerrado-panico' : 'encerrado-pelo-controlado',
              peer: from
            })
          }
          if (s.controlled.phase !== 'idle' && s.controlled.peer === from) {
            if (s.controlled.phase === 'active') effects.push({ e: 'notice', code: 'encerrado-pelo-controlador', peer: from })
            next = endControlled(next, effects)
          }
          return { state: next, effects }
        }
      }
      return same(s)
    }

    case 'request': {
      if (s.controller.phase !== 'idle') return same(s)
      return same({ ...s, controller: { phase: 'pending', peer: ev.peer } }, [
        { e: 'send', to: ev.peer, msg: { t: 'req' } }
      ])
    }

    case 'release': {
      if (s.controller.phase === 'idle') return same(s)
      return same({ ...s, controller: { phase: 'idle' } }, [
        { e: 'send', to: s.controller.peer, msg: endMsg('controlador') }
      ])
    }

    case 'allow': {
      if (s.controlled.phase !== 'asking') return same(s)
      const peer = s.controlled.peer
      if (!ev.ctx.sharing || !ev.ctx.fullScreen) {
        return same({ ...s, controlled: { phase: 'idle' } }, [
          { e: 'send', to: peer, msg: { t: 'deny', reason: 'nao-e-tela-inteira' } }
        ])
      }
      if (!ev.ctx.helperReady) {
        return same({ ...s, controlled: { phase: 'idle' } }, [{ e: 'send', to: peer, msg: { t: 'deny', reason: 'sem-helper' } }])
      }
      return same({ ...s, controlled: { phase: 'active', peer } }, [
        { e: 'helper-session', active: true, peer, monitor: ev.monitor },
        { e: 'send', to: peer, msg: { t: 'grant' } }
      ])
    }

    case 'refuse': {
      if (s.controlled.phase !== 'asking') return same(s)
      return same({ ...s, controlled: { phase: 'idle' } }, [
        { e: 'send', to: s.controlled.peer, msg: { t: 'deny', reason: 'recusado' } }
      ])
    }

    case 'stop': {
      if (s.controlled.phase === 'idle') return same(s)
      const peer = s.controlled.peer
      if (s.controlled.phase === 'asking') {
        return same({ ...s, controlled: { phase: 'idle' } }, [{ e: 'send', to: peer, msg: { t: 'deny', reason: 'recusado' } }])
      }
      effects.push({ e: 'send', to: peer, msg: endMsg(ev.by) })
      return { state: endControlled(s, effects), effects }
    }

    case 'peer-gone': {
      let next = s
      if (s.controller.phase !== 'idle' && s.controller.peer === ev.peer) {
        next = { ...next, controller: { phase: 'idle' } }
        effects.push({ e: 'notice', code: 'perdido', peer: ev.peer })
      }
      if (s.controlled.phase !== 'idle' && s.controlled.peer === ev.peer) {
        if (s.controlled.phase === 'active') effects.push({ e: 'notice', code: 'perdido', peer: ev.peer })
        next = endControlled(next, effects)
      }
      return { state: next, effects }
    }

    case 'unsafe-screen': {
      // parou de compartilhar ou deixou de ser a tela inteira
      if (ev.sharing || s.controlled.phase === 'idle') return same(s)
      const peer = s.controlled.peer
      if (s.controlled.phase === 'asking') {
        return same({ ...s, controlled: { phase: 'idle' } }, [
          { e: 'send', to: peer, msg: { t: 'deny', reason: 'nao-e-tela-inteira' } }
        ])
      }
      effects.push({ e: 'send', to: peer, msg: endMsg('controlado') })
      return { state: endControlled(s, effects), effects }
    }

    case 'helper-lost': {
      if (s.controlled.phase !== 'active') return same(s)
      effects.push({ e: 'send', to: s.controlled.peer, msg: endMsg('controlado') })
      return { state: endControlled(s, effects), effects }
    }

    case 'timeout': {
      if (ev.role === 'controller') {
        if (s.controller.phase !== 'pending' || s.controller.peer !== ev.peer) return same(s)
        return same({ ...s, controller: { phase: 'idle' } }, [
          { e: 'send', to: ev.peer, msg: endMsg('controlador') },
          { e: 'notice', code: 'sem-resposta', peer: ev.peer }
        ])
      }
      if (s.controlled.phase !== 'asking' || s.controlled.peer !== ev.peer) return same(s)
      return same({ ...s, controlled: { phase: 'idle' } }, [{ e: 'send', to: ev.peer, msg: { t: 'deny', reason: 'recusado' } }])
    }

    case 'reset': {
      if (s.controller.phase !== 'idle') effects.push({ e: 'send', to: s.controller.peer, msg: endMsg('controlador') })
      if (s.controlled.phase === 'active') effects.push({ e: 'send', to: s.controlled.peer, msg: endMsg('controlado') })
      if (s.controlled.phase === 'asking') {
        effects.push({ e: 'send', to: s.controlled.peer, msg: { t: 'deny', reason: 'recusado' } })
      }
      if (s.controlled.phase === 'active') effects.push({ e: 'helper-session', active: false })
      return { state: INITIAL_CONTROL, effects }
    }
  }
}
