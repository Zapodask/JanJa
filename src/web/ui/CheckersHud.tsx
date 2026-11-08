import { describeResult, type CheckersAction, type CheckersView } from '../../shared/games/checkers/types'
import { DuelHud, MoveList, type DuelHudCommon } from './DuelHud'

interface Props extends DuelHudCommon {
  view: CheckersView
  onAct: (action: CheckersAction) => void
}

/** Barra de baixo das damas (a parte comum com o xadrez fica no DuelHud). */
export function CheckersHud({ view, ...rest }: Props) {
  const n = view.moves.length
  const last = view.lastMove
  const cap = view.legal[0] ? view.legal[0].length - 1 : 0
  return (
    <DuelHud
      {...rest}
      view={view}
      title={n === 0 ? 'Começo da partida' : `Lance ${Math.floor(n / 2) + 1}${last ? ` · último: ${last.text}` : ''}`}
      yourTurn={
        view.mustCapture
          ? `Sua vez. Capturar é obrigatório: ${cap === 1 ? 'capture uma peça' : `capture ${cap} peças`} (vale a jogada que captura mais).`
          : 'Sua vez. Arraste a peça ou clique nela e depois na casa.'
      }
      resultText={view.result ? describeResult(view.result, view.white.name, view.black.name) : null}
      moves={<MoveList moves={view.moves.map((m) => m.text)} />}
      live={last ? `${view.turn === 'w' ? 'Pretas' : 'Brancas'} jogaram ${last.text}.${last.promote ? ' Virou dama.' : ''}` : ''}
    />
  )
}
