import { Icon } from './icons'

interface Props {
  openedBy: string
  onSit: () => void
  onLater: () => void
}

/** Convite para a mesa aberta: aparece para todos que não abriram nem sentaram. */
export function GameInvite({ openedBy, onSit, onLater }: Props) {
  return (
    <div className="game-invite" role="status">
      <span className="game-invite-icon">
        <Icon name="cards" size={20} />
      </span>
      <span className="game-invite-text">{openedBy} abriu uma mesa de Poker</span>
      <button className="primary" onClick={onSit}>
        Sentar
      </button>
      <button onClick={onLater}>Agora não</button>
    </div>
  )
}
