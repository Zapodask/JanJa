import { describeResult, type ChessAction, type ChessView } from '../../shared/games/chess/types'
import { DuelHud, MoveList, type DuelHudCommon } from './DuelHud'

interface Props extends DuelHudCommon {
  view: ChessView
  onAct: (action: ChessAction) => void
}

/** Barra de baixo do xadrez (a parte comum com as damas fica no DuelHud). */
export function ChessHud({ view, ...rest }: Props) {
  const n = view.moves.length
  const last = view.moves[n - 1]
  return (
    <DuelHud
      {...rest}
      view={view}
      title={n === 0 ? 'Começo da partida' : `Lance ${Math.floor(n / 2) + 1}${last ? ` · último: ${last.san}` : ''}`}
      yourTurn={view.check ? 'Seu rei está em xeque! Tire ele do ataque.' : 'Sua vez. Arraste a peça ou clique nela e depois na casa.'}
      resultText={view.result ? describeResult(view.result, view.white.name, view.black.name) : null}
      moves={<MoveList moves={view.moves.map((m) => m.san)} />}
      live={(last ? `${view.turn === 'w' ? 'Pretas' : 'Brancas'} jogaram ${last.san}.` : '') + (view.check && !view.result ? ' Xeque.' : '')}
    />
  )
}
