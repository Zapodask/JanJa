/**
 * Contrato da onda 2 (mesa do poker), escrito pelo planejador.
 * - CENA (Pixi): desenha a sala pixel e anima, a partir da visão e dos eventos. Não fala com a rede.
 * - SALA (React): conecta no WebSocket, mostra lobby/convite/botões/ajuda em HTML, posiciona os vídeos nas TVs.
 * - ÁUDIO: música chiptune e efeitos, gerados em Web Audio.
 */
import type { GameLobby } from '../../shared/games/protocol'
import type { CheckersView } from '../../shared/games/checkers/types'
import type { ChessView, Promo } from '../../shared/games/chess/types'
import type { GolfView } from '../../shared/games/golf/types'
import type { PokerEvent, PokerView } from '../../shared/games/poker/types'
import type { Cell, Placement } from '../../shared/games/naval/fleet'
import type { NavalView } from '../../shared/games/naval/types'
import type { MysteryAction, MysteryView } from '../../shared/games/mystery/types'
import type { PoolView } from '../../shared/games/pool/types'
import type { StopAction, StopView } from '../../shared/games/stop/types'
import type { TrucoView } from '../../shared/games/truco/types'
import type { TycoonView } from '../../shared/games/tycoon/types'

// ---------------- estado do jogo no cliente (SALA produz, CENA e ÁUDIO consomem) ----------------

export interface EventBatch {
  seq: number
  events: PokerEvent[]
}

/** lote de eventos de qualquer jogo (cada jogo estreita pelo `lobby.gameId`) */
export interface RawEventBatch {
  seq: number
  events: unknown[]
}

export interface GameClientState {
  lobby: GameLobby | null
  /** visão do jogo aberto: PokerView, GolfView, ChessView, CheckersView, TycoonView, TrucoView, NavalView, MysteryView, PoolView ou StopView, conforme `lobby.gameId` */
  view: unknown
  /** último lote de eventos recebido (a CENA anima a partir dele; o seq evita animar duas vezes) */
  lastEvents: RawEventBatch | null
  /** meu playerId na partida (null = espectador ou fora) */
  me: string | null
}

// ---------------- CENA ----------------

/** Retângulo em pixels CSS, relativo ao canto superior esquerdo do container da cena. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type SceneLayout =
  /** padrão: parede com as TVs em cima, mesa embaixo, ocupando o palco */
  | 'mesa'
  /** uma TV em destaque (vídeo grande em HTML por cima); a cena vira uma faixa baixa só com a mesa */
  | 'faixa'

export interface PokerSceneProps {
  view: PokerView
  lastEvents: EventBatch | null
  me: string | null
  /** cor de cada jogador (mesma do avatar da sala), por playerId */
  colors: Record<string, string>
  /** quantas TVs desenhar na parede (uma por tela compartilhada; 0 = uma TV desligada decorativa) */
  tvCount: number
  layout: SceneLayout
  reducedMotion: boolean
  /** a cena informa onde ficaram os buracos das TVs (para a SALA posicionar os <video>) — chamado ao mudar */
  onTvRects?: (rects: Rect[]) => void
  /** clique numa TV da parede (índice) */
  onTvClick?: (index: number) => void
  /** a cena informa onde estão as cartas destacadas da minha mão etc., se a SALA quiser ancorar HTML (opcional) */
  onAnchors?: (anchors: { myHand?: Rect; pot?: Rect; seats: Record<string, Rect> }) => void
}

/** Cena 3D do golfe (Three.js). Não posiciona TVs: as telas ficam em miniatura no canto. */
export interface GolfSceneProps {
  view: GolfView
  me: string | null
  /** cor de cada jogador, por playerId */
  colors: Record<string, string>
  reducedMotion: boolean
  /** tacada pronta (a SALA manda para o servidor) */
  onShot: (angle: number, power: number) => void
  /** som disparado pela simulação local (água, tabela, buraco) */
  onSfx?: (name: SfxName) => void
}

/** Tabuleiro do xadrez (SVG em pixel art). Também não posiciona TVs: as telas ficam em miniatura no canto. */
export interface ChessSceneProps {
  view: ChessView
  /** cor de cada jogador, por playerId */
  colors: Record<string, string>
  reducedMotion: boolean
  /** lance escolhido (a SALA manda para o servidor) */
  onMove: (from: string, to: string, promo?: Promo) => void
}

/** Tabuleiro das damas (SVG em pixel art), no mesmo molde do xadrez. */
export interface CheckersSceneProps {
  view: CheckersView
  colors: Record<string, string>
  reducedMotion: boolean
  /** lance escolhido: o caminho em casas, ex.: ["c3", "e5", "g7"] */
  onMove: (path: string[]) => void
}

/** Tabuleiro do Magnata (HTML + pixel art em SVG). As telas ficam em miniatura no canto. */
export interface TycoonSceneProps {
  view: TycoonView
  /** sem `colors`: cada jogador tem cor própria pela ordem de jogo (PLAYER_COLORS), para não repetir */
  reducedMotion: boolean
  /** clique numa casa quando o jogo pede para escolher (festival, avião) */
  onPick: (tile: number) => void
}

/** Mesa do truco (HTML + cartas em pixel art). As telas ficam em miniatura no canto. */
export interface TrucoSceneProps {
  view: TrucoView
  /** último lote de eventos: a cena mostra o balão de quem cantou (truco, envido, quero) */
  lastEvents: RawEventBatch | null
  reducedMotion: boolean
  onPlay: (card: string) => void
}

/** Batalha naval (SVG em pixel art): o seu mar e o do outro. */
export interface NavalSceneProps {
  view: NavalView
  reducedMotion: boolean
  /** frota pronta (a SALA manda para o servidor) */
  onPlace: (ships: Placement[]) => void
  /** tiro (ou a rajada da salva); a SALA põe o `ref` */
  onShoot: (cells: Cell[]) => void
}

/** Mistério (HTML + pixel art): cartas, caderno de anotações e o palpite em andamento. */
export interface MysterySceneProps {
  view: MysteryView
  reducedMotion: boolean
  onAct: (action: MysteryAction) => void
}

/** tacada da sinuca, sem o `ref` (a SALA completa) */
export interface PoolShot {
  dx: number
  dy: number
  power: number
  cue?: { x: number; y: number }
  pocket?: number
}

/** Mesa da sinuca (canvas 2D em pixel art). A cena anima a tacada a partir do "antes". */
export interface PoolSceneProps {
  view: PoolView
  reducedMotion: boolean
  onShoot: (shot: PoolShot) => void
  /** som da simulação local (bola caindo na caçapa) */
  onSfx?: (name: SfxName) => void
}

/** Stop (HTML): campos das categorias e a conferência. As respostas são salvas sozinhas. */
export interface StopSceneProps {
  view: StopView
  onAct: (action: StopAction) => void
}

// ---------------- ÁUDIO ----------------

export type MusicTrack = 'calma' | 'cisnes' | 'tensao' | 'vitoria' | 'tiroteio' | 'final'

export interface GameAudio {
  /** liga a música (precisa de gesto do usuário antes; chame depois de um clique) */
  startMusic(track?: MusicTrack): void
  stopMusic(): void
  /** troca de faixa sincronizada no próximo compasso, com crossfade */
  setTrack(track: MusicTrack): void
  setMusicVolume(v: number): void // 0..1
  /** 0 = sem ducking, 1 = abaixa ao máximo (a SALA passa o nível de voz da sala) */
  setDuck(level: number): void
  /** efeito sonoro para um evento do jogo (respeita o liga/desliga dos sons da sala, controlado pela SALA) */
  sfx(name: SfxName, opts?: SfxOpts): void
  dispose(): void
}

/** `volume` 0..1 (padrão 1) e `pan` -1..1 (esquerda..direita): o tiro usa os dois pela distância */
export interface SfxOpts {
  count?: number
  volume?: number
  pan?: number
}

export type SfxName =
  | 'shuffle'
  | 'deal'
  | 'flip'
  | 'chip'
  | 'check'
  | 'fold'
  | 'turn'
  | 'allin'
  | 'win'
  | 'rebuy'
  | 'podium'
  // golfe
  | 'putt'
  | 'cup'
  | 'splash'
  | 'bounce'
  // tiro na sala
  | 'tiro-pistola'
  | 'tiro-escopeta'
  | 'tiro-sub'
  | 'tiro-rifle'
  | 'tiro-rolha'
  | 'explosao'
  | 'granada'
  | 'hitmarker'
  | 'dano'
  | 'abate'
  | 'passo'
  | 'dash'
  | 'pegar-arma'
  | 'pegar-vida'
  | 'renascer'
  | 'contagem'

/** nomes de efeito do tiro (a cena pede por string; isto valida) */
export const SHOOTER_SFX: readonly SfxName[] = [
  'tiro-pistola',
  'tiro-escopeta',
  'tiro-sub',
  'tiro-rifle',
  'tiro-rolha',
  'explosao',
  'granada',
  'hitmarker',
  'dano',
  'abate',
  'passo',
  'dash',
  'pegar-arma',
  'pegar-vida',
  'renascer',
  'contagem'
]
