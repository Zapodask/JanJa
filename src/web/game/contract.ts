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
  /** visão do jogo aberto: PokerView, GolfView, ChessView, CheckersView, TycoonView, TrucoView, NavalView ou MysteryView, conforme `lobby.gameId` */
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

// ---------------- ÁUDIO ----------------

export type MusicTrack = 'calma' | 'tensao' | 'vitoria'

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
  sfx(name: SfxName, opts?: { count?: number }): void
  dispose(): void
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
