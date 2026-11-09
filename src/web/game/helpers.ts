/** Funções puras da SALA do jogo: botões, atalhos, sons, textos. Sem React nem DOM (testáveis em Node). */
import { rankName, rankValue, SUIT_NAME, suitOf } from '../../shared/games/poker/cards'
import type { CheckersEvent } from '../../shared/games/checkers/types'
import type { ChessEvent } from '../../shared/games/chess/types'
import type { GolfEvent } from '../../shared/games/golf/types'
import type { MysteryEvent } from '../../shared/games/mystery/types'
import type { NavalEvent } from '../../shared/games/naval/types'
import type { PoolEvent } from '../../shared/games/pool/types'
import type { StopEvent } from '../../shared/games/stop/types'
import type { TrucoEvent } from '../../shared/games/truco/types'
import type { TycoonEvent } from '../../shared/games/tycoon/types'
import type { Card, LegalAction, PokerAction, PokerEvent, PokerMode, PokerView } from '../../shared/games/poker/types'
import type { MusicTrack, Rect, SfxName } from './contract'

// ---------- botões de ação ----------

export interface ActionButton {
  action: PokerAction
  label: string
  /** tecla de atalho (maiúscula) ou null */
  key: 'P' | 'A' | 'D' | null
  tone: 'primary' | 'default' | 'danger'
}

const ORDER: Record<LegalAction['kind'], number> = { fold: 0, check: 1, call: 1, raise: 2, allin: 3 }

/** Botões na ordem da tela: Desistir, Passar/Pagar, Aumentar, Tudo. Rótulos já com os valores. */
export function actionButtons(legal: LegalAction[]): ActionButton[] {
  const canCheck = legal.some((a) => a.kind === 'check')
  const hasRaise = legal.some((a) => a.kind === 'raise')
  const out = legal.map((a): ActionButton => {
    switch (a.kind) {
      case 'check':
        return { action: { kind: 'check' }, label: 'Passar', key: 'P', tone: 'default' }
      case 'call':
        return { action: { kind: 'call' }, label: `Pagar ${a.amount}`, key: 'P', tone: 'primary' }
      case 'raise':
        return {
          action: { kind: 'raise' },
          label: canCheck ? `Apostar ${a.to}` : `Aumentar para ${a.to}`,
          key: 'A',
          tone: 'default'
        }
      case 'allin':
        return { action: { kind: 'allin' }, label: `Tudo (${a.amount})`, key: hasRaise ? null : 'A', tone: 'default' }
      case 'fold':
        return { action: { kind: 'fold' }, label: 'Desistir', key: 'D', tone: 'danger' }
    }
  })
  return out.sort((x, y) => ORDER[x.action.kind] - ORDER[y.action.kind])
}

/** P = passar ou pagar (o que for legal), A = aumentar (ou tudo), D = desistir. */
export function shortcutAction(key: string, legal: LegalAction[]): PokerAction | null {
  const has = (k: LegalAction['kind']) => legal.some((a) => a.kind === k)
  switch (key.toLowerCase()) {
    case 'p':
      return has('check') ? { kind: 'check' } : has('call') ? { kind: 'call' } : null
    case 'a':
      return has('raise') ? { kind: 'raise' } : has('allin') ? { kind: 'allin' } : null
    case 'd':
      return has('fold') ? { kind: 'fold' } : null
    default:
      return null
  }
}

// ---------- eventos -> sons e faixas ----------

export interface SfxCue {
  name: SfxName
  count?: number
}

const chips = (amount: number): number => Math.max(1, Math.min(6, Math.ceil(amount / 20)))

export function sfxForEvent(ev: PokerEvent): SfxCue | null {
  switch (ev.kind) {
    case 'shuffle':
      return { name: 'shuffle' }
    case 'deal':
      return { name: 'deal', count: Math.max(1, ev.to.length * ev.count) }
    case 'street':
      return ev.street === 'flop' ? { name: 'flip', count: ev.cards.length } : { name: 'turn' }
    case 'blind':
    case 'ante':
      return { name: 'chip', count: chips(ev.amount) }
    case 'act':
      if (ev.action === 'check') return { name: 'check' }
      if (ev.action === 'fold') return { name: 'fold' }
      if (ev.action === 'allin') return { name: 'allin' }
      return { name: 'chip', count: chips(ev.amount) }
    case 'timeout':
      return { name: 'fold' }
    case 'reveal':
      return { name: 'flip', count: ev.cards.length }
    case 'win':
      return { name: 'win' }
    case 'rebuy':
      return { name: 'rebuy' }
    case 'end':
      return { name: 'podium' }
    case 'away':
      return null
  }
}

/** Faixa de música que o evento pede (null = não muda). All-in tensiona, fim vence, mão nova acalma. */
export function trackForEvent(ev: PokerEvent): MusicTrack | null {
  if (ev.kind === 'act' && ev.action === 'allin') return 'tensao'
  if (ev.kind === 'end') return 'vitoria'
  if (ev.kind === 'shuffle') return 'calma'
  return null
}

/** Som de um evento do golfe. Água, tabela e o buraco vêm da simulação local (a cena avisa). */
export function golfSfxForEvent(ev: GolfEvent): SfxCue | null {
  switch (ev.type) {
    case 'shot':
      return { name: 'putt' }
    case 'hole-end':
      return { name: 'win' }
    case 'game-over':
      return { name: 'podium' }
    default:
      return null
  }
}

export function golfTrackForEvent(ev: GolfEvent): MusicTrack | null {
  if (ev.type === 'game-over') return 'vitoria'
  if (ev.type === 'hole-start') return 'calma'
  return null
}

/** Som de um evento do xadrez: toque da peça, captura, xeque e o fim. */
export function chessSfxForEvent(ev: ChessEvent): SfxCue | null {
  switch (ev.type) {
    case 'start':
      return { name: 'shuffle' }
    case 'move':
      return ev.check ? { name: 'turn' } : ev.capture ? { name: 'chip' } : { name: 'putt' }
    case 'draw-offer':
      return { name: 'check' }
    case 'end':
      return ev.result.winner ? { name: 'podium' } : { name: 'win' }
    default:
      return null
  }
}

export function chessTrackForEvent(ev: ChessEvent): MusicTrack | null {
  if (ev.type === 'start') return 'calma'
  if (ev.type === 'end') return 'vitoria'
  if (ev.type === 'move' && ev.check) return 'tensao'
  return null
}

/** Som de um evento das damas: toque da pedra, capturas (uma ficha por peça), dama nova e o fim. */
export function checkersSfxForEvent(ev: CheckersEvent): SfxCue | null {
  switch (ev.type) {
    case 'start':
      return { name: 'shuffle' }
    case 'move':
      if (ev.promote) return { name: 'win' }
      return ev.captures ? { name: 'chip', count: ev.captures } : { name: 'putt' }
    case 'draw-offer':
      return { name: 'check' }
    case 'end':
      return ev.result.winner ? { name: 'podium' } : { name: 'win' }
    default:
      return null
  }
}

export function checkersTrackForEvent(ev: CheckersEvent): MusicTrack | null {
  if (ev.type === 'start') return 'calma'
  if (ev.type === 'end') return 'vitoria'
  if (ev.type === 'move' && ev.captures >= 2) return 'tensao'
  return null
}

/** Som de um evento do Magnata: dados, fichas para dinheiro, carta virando e o fim. */
export function tycoonSfxForEvent(ev: TycoonEvent): SfxCue | null {
  switch (ev.type) {
    case 'roll':
      return { name: 'shuffle' }
    case 'buy':
    case 'build':
      return { name: 'chip', count: 1 + ev.level }
    case 'pay':
      return ev.why === 'aluguel' ? { name: 'chip', count: 3 } : null
    case 'takeover':
      return { name: 'allin' }
    case 'card':
      return { name: 'flip' }
    case 'jam':
      return { name: 'check' }
    case 'salary':
      return { name: 'rebuy' }
    case 'bankrupt':
      return { name: 'fold' }
    case 'end':
      return { name: 'podium' }
    default:
      return null
  }
}

export function tycoonTrackForEvent(ev: TycoonEvent): MusicTrack | null {
  if (ev.type === 'start') return 'calma'
  if (ev.type === 'takeover' || ev.type === 'bankrupt') return 'tensao'
  if (ev.type === 'end') return 'vitoria'
  return null
}

/** Som de um evento do truco: dar cartas, carta na mesa, gritos de truco e o fim. */
export function trucoSfxForEvent(ev: TrucoEvent): SfxCue | null {
  switch (ev.type) {
    case 'deal':
      return { name: 'shuffle' }
    case 'play':
      return { name: 'flip' }
    case 'call':
      return ev.call === 'truco' || ev.call === 'retruco' || ev.call === 'vale4' || ev.call === 'contraflor' ? { name: 'allin' } : { name: 'chip' }
    case 'answer':
      return ev.quero ? { name: 'check' } : { name: 'fold' }
    case 'mazo':
      return { name: 'fold' }
    case 'mesa-end':
      return { name: 'win' }
    case 'end':
      return { name: 'podium' }
    default:
      return null
  }
}

export function trucoTrackForEvent(ev: TrucoEvent): MusicTrack | null {
  if (ev.type === 'deal') return 'calma'
  if (ev.type === 'call' && (ev.call === 'retruco' || ev.call === 'vale4' || ev.call === 'falta')) return 'tensao'
  if (ev.type === 'end') return 'vitoria'
  return null
}

/** Som de um evento da batalha naval: água, acerto, navio afundado e o fim. */
export function navalSfxForEvent(ev: NavalEvent): SfxCue | null {
  switch (ev.type) {
    case 'battle':
      return { name: 'shuffle' }
    case 'shot':
      if (ev.sunk.length) return { name: 'win' }
      return ev.cells.some((c) => c.hit) ? { name: 'bounce' } : { name: 'splash' }
    case 'end':
      return { name: 'podium' }
    default:
      return null
  }
}

export function navalTrackForEvent(ev: NavalEvent): MusicTrack | null {
  if (ev.type === 'battle') return 'calma'
  if (ev.type === 'shot' && ev.sunk.length) return 'tensao'
  if (ev.type === 'end') return 'vitoria'
  return null
}

/** Som de um evento do Mistério: palpite, carta mostrada, acusação e o fim. */
export function mysterySfxForEvent(ev: MysteryEvent): SfxCue | null {
  switch (ev.type) {
    case 'start':
      return { name: 'shuffle' }
    case 'suggest':
      return { name: 'turn' }
    case 'shown':
      return { name: 'flip' }
    case 'none':
      return { name: 'check' }
    case 'accuse':
      return ev.correct ? null : { name: 'fold' }
    case 'end':
      return { name: 'podium' }
  }
}

export function mysteryTrackForEvent(ev: MysteryEvent): MusicTrack | null {
  if (ev.type === 'start') return 'calma'
  if (ev.type === 'accuse') return 'tensao'
  if (ev.type === 'end') return 'vitoria'
  return null
}

/** Som de um evento da sinuca: tacada, falta e o fim (a bola na caçapa vem da cena). */
export function poolSfxForEvent(ev: PoolEvent): SfxCue | null {
  switch (ev.type) {
    case 'start':
      return { name: 'shuffle' }
    case 'shot':
      return { name: 'putt' }
    case 'foul':
      return { name: 'fold' }
    case 'end':
      return { name: 'podium' }
    default:
      return null
  }
}

export function poolTrackForEvent(ev: PoolEvent): MusicTrack | null {
  if (ev.type === 'start') return 'calma'
  if (ev.type === 'groups') return 'tensao'
  if (ev.type === 'end') return 'vitoria'
  return null
}

/** Som de um evento do Stop: letra nova, o grito, a conferência e os pontos. */
export function stopSfxForEvent(ev: StopEvent): SfxCue | null {
  switch (ev.type) {
    case 'round':
      return { name: 'shuffle' }
    case 'stop':
      return { name: 'allin' }
    case 'review':
      return { name: 'flip' }
    case 'scores':
      return { name: 'win' }
    case 'end':
      return { name: 'podium' }
  }
}

export function stopTrackForEvent(ev: StopEvent): MusicTrack | null {
  if (ev.type === 'round') return 'tensao'
  if (ev.type === 'review') return 'calma'
  if (ev.type === 'end') return 'vitoria'
  return null
}

/** Nível de ducking (0..1) a partir do maior nível de voz da sala. */
/**
 * A música da partida toca para quem joga (sentado) e para quem assiste com a mesa aberta.
 * Quem está só na sala (voz, tela compartilhada, mesa fechada) não ouve.
 */
export function wantsGameMusic(o: { seated: boolean; watching: boolean; started: boolean; musicOn: boolean }): boolean {
  return o.started && o.musicOn && (o.seated || o.watching)
}

export const duckFromLevel = (level: number): number => Math.max(0, Math.min(1, (level - 0.03) * 5))

// ---------- textos ----------

export function cardName(c: Card): string {
  const v = rankValue(c)
  const r = rankName(v)
  return `${r} de ${SUIT_NAME[suitOf(c)]}`
}

/** "12:05" a partir de ms; nunca negativo. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export interface HandRow {
  name: string
  example: string
  hint: string
}

/** Tabela de mãos, da mais forte para a mais fraca (a ordem muda no modo de 3 cartas). */
export function handsTable(mode: PokerMode): HandRow[] {
  const royal: HandRow = { name: 'Royal flush', example: 'A K Q J 10 do mesmo naipe', hint: 'a melhor de todas' }
  const sf: HandRow = { name: 'Straight flush', example: '5 6 7 8 9 do mesmo naipe', hint: 'sequência e mesmo naipe' }
  const quad: HandRow = { name: 'Quadra', example: '8 8 8 8 e uma carta', hint: 'quatro iguais' }
  const full: HandRow = { name: 'Full house', example: '7 7 7 e K K', hint: 'trinca mais par' }
  const flush: HandRow = { name: 'Flush', example: 'cinco cartas de copas', hint: 'mesmo naipe' }
  const straight: HandRow = { name: 'Sequência', example: '4 5 6 7 8', hint: 'números seguidos' }
  const trips: HandRow = { name: 'Trinca', example: '9 9 9', hint: 'três iguais' }
  const two: HandRow = { name: 'Dois pares', example: 'A A e 6 6', hint: 'dois pares diferentes' }
  const pair: HandRow = { name: 'Par', example: 'K K', hint: 'duas iguais' }
  const high: HandRow = { name: 'Carta alta', example: 'A', hint: 'nada acima, vale a maior' }
  if (mode === 'tres') {
    return [
      { ...sf, example: '7 8 9 do mesmo naipe', hint: 'sequência e mesmo naipe' },
      { ...trips },
      { ...straight, example: '4 5 6', hint: 'números seguidos' },
      { ...flush, example: 'três cartas de copas' },
      pair,
      high
    ]
  }
  return [royal, sf, quad, full, flush, straight, trips, two, pair, high]
}

/** Texto para leitor de tela: minha mão, a mesa e o que posso fazer agora. */
export function describeForScreenReader(view: PokerView, me: string | null): string {
  const parts: string[] = []
  if (view.you?.hand.length) parts.push(`Sua mão: ${view.you.hand.map(cardName).join(', ')}.`)
  if (view.board.length) parts.push(`Na mesa: ${view.board.map(cardName).join(', ')}.`)
  if (view.you?.best) parts.push(`Você tem ${view.you.best.name}${view.you.best.onTable ? ', que está na mesa e vale para todos' : ''}.`)
  if (me && view.toAct === me && view.legal.length) {
    parts.push(`Sua vez. Você pode: ${actionButtons(view.legal).map((b) => b.label).join(', ')}.`)
  } else if (view.toAct) {
    const who = view.seats.find((s) => s.playerId === view.toAct)?.name
    if (who) parts.push(`Vez de ${who}.`)
  }
  if (view.showdown) parts.push(view.showdown.explanation)
  return parts.join(' ')
}

// ---------- convite ----------

/** O convite "X abriu uma mesa" aparece para quem não abriu, não está sentado e ainda não dispensou. */
export function shouldInvite(
  lobby: { started: boolean; openedBy: string } | null,
  seated: boolean,
  myName: string,
  dismissedFor: string | null
): boolean {
  if (!lobby || lobby.started || seated) return false
  if (lobby.openedBy === myName) return false
  return dismissedFor !== lobby.openedBy
}

/** Mesmos retângulos (evita re-render quando a cena repete o relatório). */
export function sameRects(a: Rect[], b: Rect[]): boolean {
  return a.length === b.length && a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.w === b[i].w && r.h === b[i].h)
}
