import type { GameId } from '../../shared/games/protocol'
import { Icon } from './icons'

interface Props {
  gameId: GameId
  openedBy: string
  onSit: () => void
  onLater: () => void
}

/** Convite para o jogo aberto: aparece para todos que não abriram nem entraram. */
export function GameInvite({ gameId, openedBy, onSit, onLater }: Props) {
  const golf = gameId === 'golf'
  const chess = gameId === 'chess' || gameId === 'checkers'
  const tycoon = gameId === 'tycoon'
  const truco = gameId === 'truco'
  const naval = gameId === 'naval'
  const text = naval
    ? `${openedBy} chamou para uma Batalha naval`
    : truco
    ? `${openedBy} abriu uma mesa de Truco`
    : golf
    ? `${openedBy} abriu uma partida de Golfe`
    : tycoon
      ? `${openedBy} abriu uma partida de Magnata`
    : chess
      ? `${openedBy} abriu uma partida de ${gameId === 'chess' ? 'Xadrez' : 'Damas'}`
      : `${openedBy} abriu uma mesa de Poker`
  return (
    <div className="game-invite" role="status">
      <span className="game-invite-icon">
        <Icon name={naval ? 'anchor' : truco ? 'sword' : golf ? 'flag' : tycoon ? 'dice' : gameId === 'checkers' ? 'checker' : chess ? 'pawn' : 'cards'} size={20} />
      </span>
      <span className="game-invite-text">{text}</span>
      <button className="primary" onClick={onSit}>
        {golf || tycoon ? 'Entrar' : chess ? 'Jogar' : 'Sentar'}
      </button>
      <button onClick={onLater}>Agora não</button>
    </div>
  )
}
