import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { DEFAULT_ROOM_NAME, roomUrl } from '../../shared/protocol'
import { useAudioLevel, useSpeaking } from '../audio'
import type { PeerView, Route } from '../rtc/PeerManager'
import { useControl } from '../control/useControl'
import { AUTO_PRESET, PRESETS, bitrateFor, isAuto, presetById } from '../rtc/quality'
import { getPrefs, recentRooms, rememberRoom, setPrefs, volumeKey } from '../storage'
import { useAudioBlocked } from '../playback'
import { playDoorbell, playKnock, playShareOn, setSoundSink } from '../sounds'
import { canShareScreen, canUseCamera, useRoom } from '../useRoom'
import { CamFocus, CamStrip, type CamItem } from './Cams'
import { ChannelList, DownloadBox, OtherRooms, ServerCard } from './Channels'
import { ChatPanel, type ChatMode } from './ChatPanel'
import type { CheckersAction, CheckersView } from '../../shared/games/checkers/types'
import type { ChessAction, ChessView, Promo } from '../../shared/games/chess/types'
import type { GolfView } from '../../shared/games/golf/types'
import type { ShooterView } from '../../shared/games/shooter/types'
import type { PokerView } from '../../shared/games/poker/types'
import type { Cell, Placement } from '../../shared/games/naval/fleet'
import type { MysteryAction, MysteryView } from '../../shared/games/mystery/types'
import type { PoolAction, PoolView } from '../../shared/games/pool/types'
import type { StopAction, StopView } from '../../shared/games/stop/types'
import type { NavalAction, NavalView } from '../../shared/games/naval/types'
import type { TrucoAction, TrucoIntent, TrucoView } from '../../shared/games/truco/types'
import type { TycoonAction, TycoonView } from '../../shared/games/tycoon/types'
import type { EventBatch, MusicTrack, PoolShot, Rect, SceneLayout, SfxName } from '../game/contract'
import { GameAudioDriver } from '../game/GameAudioDriver'
import { sameRects, shortcutAction, shouldInvite } from '../game/helpers'
import { createSfxBus } from '../game/shooter/sfxBus'
import { loadCheckersScene, loadChessScene, loadGolfScene, loadMysteryScene, loadNavalScene, loadPoolScene, loadScene, loadStopScene, loadTrucoScene, loadTycoonScene } from '../game/loaders'
import { Avatar, toneOf } from './Avatar'
import { GameInvite } from './GameInvite'
import { GamesPanel } from './GamesPanel'
import { ControlBanner, ControlRequestModal, ControlSection } from './Control'
import { Brand, TvOff } from './Brand'
import { Jan } from './Pixel'
import { Dropdown, type DropdownOption } from './Dropdown'
import { Icon, SignalBars, type IconName } from './icons'
import { SignalPanel } from './SignalPanel'
import { LIT, signalHealth } from './signalLogic'
import { RemoteAudio, toggleFullscreen, VideoTile } from './media'
import { useToast } from './Toasts'
import { startTour, stopTour, tourActive } from './tour'
import { ROOM_STEPS, shouldAskTour, shouldAutoTour } from './tourLogic'
import { TourPrompt } from './TourPrompt'

// a mesa (Pixi, GSAP, HUD) só é baixada quando há partida
const PokerSceneLazy = lazy(loadScene)
const PokerHudLazy = lazy(() => import('./PokerHud').then((m) => ({ default: m.PokerHud })))
// o golfe (Three.js) também só baixa quando há partida de golfe
const GolfSceneLazy = lazy(loadGolfScene)
const GolfHudLazy = lazy(() => import('./GolfHud').then((m) => ({ default: m.GolfHud })))
// o tabuleiro do xadrez também
const ChessSceneLazy = lazy(loadChessScene)
const ChessHudLazy = lazy(() => import('./ChessHud').then((m) => ({ default: m.ChessHud })))
// e o das damas
const CheckersSceneLazy = lazy(loadCheckersScene)
const CheckersHudLazy = lazy(() => import('./CheckersHud').then((m) => ({ default: m.CheckersHud })))
// e o do Magnata
const TycoonSceneLazy = lazy(loadTycoonScene)
const TycoonHudLazy = lazy(() => import('./TycoonHud').then((m) => ({ default: m.TycoonHud })))
// e a mesa do truco
const TrucoSceneLazy = lazy(loadTrucoScene)
const TrucoHudLazy = lazy(() => import('./TrucoHud').then((m) => ({ default: m.TrucoHud })))
// e o Tiro na Sala (a cena Pixi dele ainda é outro pedaço, baixado por loadShooterScene)
const ShooterStageLazy = lazy(() => import('./ShooterStage').then((m) => ({ default: m.ShooterStage })))
// e a batalha naval
const NavalSceneLazy = lazy(loadNavalScene)
const NavalHudLazy = lazy(() => import('./NavalHud').then((m) => ({ default: m.NavalHud })))
// e o Mistério
const MysterySceneLazy = lazy(loadMysteryScene)
const MysteryHudLazy = lazy(() => import('./MysteryHud').then((m) => ({ default: m.MysteryHud })))
// e o Stop
const StopSceneLazy = lazy(loadStopScene)
const StopHudLazy = lazy(() => import('./StopHud').then((m) => ({ default: m.StopHud })))
// e a sinuca
const PoolSceneLazy = lazy(loadPoolScene)
const PoolHudLazy = lazy(() => import('./PoolHud').then((m) => ({ default: m.PoolHud })))

/** onde ficam as telas compartilhadas durante o golfe e os jogos de tabuleiro: miniaturas empilhadas no canto de cima */
const CORNER_TV = { w: 208, h: 117, gap: 8, edge: 12 }

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const h = () => setOn(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [query])
  return on
}

const ROUTE_LABEL: Record<Route, string> = {
  conectando: 'conectando',
  direto: 'direto',
  relay: 'via relay',
  falhou: 'falhou'
}

const QUALITY_ICON: Record<string, IconName> = { auto: 'signal', texto: 'panel', equilibrado: 'grid', jogo: 'screen', jogo60: 'focus', nitido: 'expand' }

function routeInfo(p: PeerView): string {
  const parts = [ROUTE_LABEL[p.route]]
  if (p.rttMs !== undefined) parts.push(`${p.rttMs} ms`)
  if (p.inKbps) parts.push(`${(p.inKbps / 1000).toFixed(1)} Mbps`)
  return parts.join(', ')
}

function useOutputDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.enumerateDevices) return
    const refresh = () =>
      md
        .enumerateDevices()
        .then((list) => setDevices(list.filter((d) => d.kind === 'audiooutput' && d.deviceId)))
        .catch(() => undefined)
    void refresh()
    md.addEventListener('devicechange', refresh)
    return () => md.removeEventListener('devicechange', refresh)
  }, [])
  return devices
}

interface Props {
  roomId: string
  name: string
  hostKey?: string
  onLeave: () => void
  /** abre outra sala (lista de "Outras salas") */
  onOpenRoom: (roomId: string) => void
}

export function Room({ roomId, name, hostKey, onLeave, onOpenRoom }: Props) {
  const {
    state,
    toggleMic,
    startShare,
    stopShare,
    startCamera,
    stopCamera,
    setPreset,
    answerRequest,
    reconnect,
    game,
    gameApi,
    gameError,
    roomApi,
    roomNotice
  } = useRoom(roomId, name, hostKey)
  // salas visitadas antes, menos esta (lidas uma vez ao entrar)
  const [otherRooms] = useState(() => recentRooms().filter((r) => r.roomId !== roomId).slice(0, 4))
  const toast = useToast()
  const control = useControl({ manager: state.manager, screen: state.screen, peers: state.peers, notify: toast })
  const controlling = control.controller.phase === 'active'
  const controlledPeer = control.controlled.phase === 'idle' ? undefined : control.controlled.peer
  const controlledBy = controlledPeer ? (state.peers.find((p) => p.id === controlledPeer)?.name ?? 'Alguém') : undefined
  const [sinkId, setSinkId] = useState(() => getPrefs().sinkId)
  const [volumes, setVolumes] = useState<Record<string, number>>(() => getPrefs().volumes)
  const [sidebarOpen, setSidebarOpen] = useState(() => getPrefs().sidebarOpen)
  const [showStats, setShowStats] = useState(() => getPrefs().showStats)
  const [signalOpen, setSignalOpen] = useState(false)
  const [soundsOn, setSoundsOn] = useState(() => getPrefs().sounds)
  const audioBlocked = useAudioBlocked()
  const outputs = useOutputDevices()
  const link = roomUrl(location.origin, roomId)
  const canShare = canShareScreen()
  const canCam = canUseCamera()

  const micMuted = state.me.micMuted
  const micActive = !micMuted && !!state.micStream
  const myLevel = useAudioLevel(state.micStream, micActive)
  const mySpeaking = useSpeaking(state.micStream, micActive)

  const vol = (kind: 'mic' | 'screen', who: string) => volumes[volumeKey(kind, who)] ?? 1
  const setVol = (kind: 'mic' | 'screen', who: string, v: number) => {
    const next = { ...volumes, [volumeKey(kind, who)]: v }
    setVolumes(next)
    setPrefs({ volumes: next })
  }

  // pedido de entrada aparece no título da aba, para o host ver mesmo em outra aba
  // o nome da sala vai no título da aba (e o pedido de entrada aparece mesmo em outra aba)
  const tabName = state.settings.name && state.settings.name !== DEFAULT_ROOM_NAME ? `${state.settings.name} · JanJa` : 'JanJa'
  useEffect(() => {
    document.title = state.requests.length ? `(${state.requests.length}) Pedido de entrada · ${tabName}` : tabName
    return () => {
      document.title = 'JanJa'
    }
  }, [state.requests.length, tabName])

  // lembra a sala (e quem estava nela, de todos os canais) para a lista de recentes
  const othersKey = state.roster.map((p) => p.name).join('\n')
  const roomName = state.settings.name
  useEffect(() => {
    if (state.status !== 'na-sala') return
    rememberRoom({ roomId, name: roomName || undefined, people: othersKey ? othersKey.split('\n') : [], host: state.isHost })
  }, [state.status, state.isHost, roomId, othersKey, roomName])

  // avisos de quem entrou e saiu da sala (trocar de canal não conta; o primeiro retrato não gera aviso)
  const seen = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    if (state.status !== 'na-sala') {
      seen.current = null
      return
    }
    const now = new Map(state.roster.map((p) => [p.peerId, p.name]))
    const prev = seen.current
    seen.current = now
    if (!prev) return
    for (const [id, n] of now) if (!prev.has(id)) toast(`${n} entrou`, 'ok')
    for (const [id, n] of prev) if (!now.has(id)) toast(`${n} saiu`, 'info')
  }, [state.status, state.roster, toast])

  // erros de canal (ex.: canal apagado enquanto você clicava)
  useEffect(() => {
    if (roomNotice) toast(roomNotice.message, 'warn')
  }, [roomNotice, toast])

  // campainha para cada pedido de entrada novo (só quem aprova recebe pedidos)
  const rang = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const r of state.requests) {
      if (rang.current.has(r.requestId)) continue
      rang.current.add(r.requestId)
      if (soundsOn) playDoorbell()
    }
  }, [state.requests, soundsOn])

  // som de TV ligando quando alguém da sala começa a compartilhar (quem já compartilhava ao entrar não toca)
  const sharing = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (state.status !== 'na-sala') {
      sharing.current = null
      return
    }
    const now = new Set(state.peers.filter((p) => p.screen).map((p) => p.id))
    const prev = sharing.current
    sharing.current = now
    if (!prev || !soundsOn) return
    for (const id of now) {
      if (!prev.has(id)) {
        playShareOn()
        break
      }
    }
  }, [state.status, state.peers, soundsOn])

  // "toc-toc" para quem compartilha quando alguém pede o controle do PC
  const askingPeer = control.controlled.phase === 'asking' ? control.controlled.peer : undefined
  useEffect(() => {
    if (askingPeer && soundsOn) playKnock()
  }, [askingPeer, soundsOn])

  // tour guiado: abre a barra lateral só durante o tour (sem gravar na pref) e restaura no fim
  const tourTimer = useRef<number | undefined>(undefined)
  const runTour = useCallback(() => {
    setSidebarOpen(true)
    window.clearTimeout(tourTimer.current)
    tourTimer.current = window.setTimeout(
      () => startTour('room', ROOM_STEPS, () => setSidebarOpen(getPrefs().sidebarOpen)),
      getPrefs().sidebarOpen ? 0 : 320
    )
  }, [])
  useEffect(
    () => () => {
      window.clearTimeout(tourTimer.current)
      stopTour(true)
    },
    []
  )
  // começa sozinho na primeira vez; espera modais (pedido de entrada ou de controle) fecharem
  const tourBusy = state.requests.length > 0 || control.controlled.phase === 'asking'
  // primeira visita direto pelo link da sala: a pergunta aparece aqui
  const [askTour, setAskTour] = useState(false)
  useEffect(() => {
    if (tourBusy && tourActive()) stopTour(true)
    if (state.status !== 'na-sala' || tourBusy) return
    const p = getPrefs()
    if (shouldAskTour(p.tourAnswer, p.tourDone, p.homeTourDone)) {
      const t = window.setTimeout(() => setAskTour(true), 800)
      return () => window.clearTimeout(t)
    }
    if (!shouldAutoTour(p.tourAnswer, p.tourDone)) return
    const t = window.setTimeout(runTour, 800)
    return () => window.clearTimeout(t)
  }, [state.status, tourBusy, runTour])

  // erro do microfone vira aviso
  useEffect(() => {
    if (state.micError) toast(state.micError, 'error', 8000)
  }, [state.micError, toast])

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast('Link copiado', 'ok')
    } catch {
      window.prompt('Copie o link da sala:', link)
    }
  }, [link, toast])

  const share = useCallback(async () => {
    try {
      const { hasAudio } = await startShare(state.preset)
      if (!hasAudio) {
        toast(
          'Compartilhando sem som. Para enviar o áudio, marque "Compartilhar áudio" no seletor do navegador. Se a opção não aparecer na janela, compartilhe a tela inteira.',
          'warn',
          10000
        )
      }
    } catch (err) {
      // cancelar o seletor do navegador não é erro
      if (err instanceof DOMException && err.name === 'NotAllowedError') return
      toast(`Não deu para compartilhar: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [startShare, state.preset, toast])

  const toggleCamera = useCallback(async () => {
    if (state.camera) return stopCamera()
    if (state.cameraPending) return
    const err = await startCamera()
    if (err) toast(err, 'error', 8000)
  }, [state.camera, state.cameraPending, startCamera, stopCamera, toast])

  // webcams: a sua primeiro, depois as dos outros (só quando a imagem chegou)
  const camItems = useMemo(() => {
    const list: CamItem[] = []
    if (state.camera) list.push({ id: 'me', name, stream: state.camera, mic: state.micStream, micMuted: state.me.micMuted || !state.micStream, local: true })
    for (const p of state.peers)
      if (p.cam && p.cam.getVideoTracks().length > 0) list.push({ id: p.id, name: p.name, stream: p.cam, mic: p.mic, micMuted: p.state.micMuted })
    return list
  }, [state.camera, state.micStream, state.me.micMuted, state.peers, name])

  // câmera maximizada (clique numa câmera, como no Teams); some sozinha se a pessoa desligar
  const [pinnedCam, setPinnedCam] = useState<string | null>(null)
  const pinnedItem = pinnedCam ? camItems.find((c) => c.id === pinnedCam) : undefined
  const pinCam = useCallback((id: string) => setPinnedCam((cur) => (cur === id ? null : id)), [])
  const pinnedRef = useRef(false)
  pinnedRef.current = !!pinnedItem

  const tiles = useMemo(() => {
    const list: { id: string; label: string; stream: MediaStream; local?: boolean }[] = []
    if (state.screen) list.push({ id: 'me', label: `${name} (você)`, stream: state.screen, local: true })
    // só vira TV quando a imagem chegou (o áudio da tela pode chegar antes)
    for (const p of state.peers) if (p.screen && p.screen.getVideoTracks().length > 0) list.push({ id: p.id, label: p.name, stream: p.screen })
    return list
  }, [state.screen, state.peers, name])

  // telas que pararam ficam montadas por ~350 ms para rodar a animação de TV desligando
  const [ghosts, setGhosts] = useState<typeof tiles>([])
  const prevTiles = useRef(tiles)
  useEffect(() => {
    const ids = new Set(tiles.map((t) => t.id))
    const gone = prevTiles.current.filter((t) => !ids.has(t.id))
    prevTiles.current = tiles
    setGhosts((g) => [...g.filter((x) => !ids.has(x.id)), ...gone.filter((t) => !g.some((x) => x.id === t.id))])
    if (!gone.length) return
    setTimeout(() => {
      const goneIds = new Set(gone.map((t) => t.id))
      setGhosts((g) => g.filter((x) => !goneIds.has(x.id)))
    }, 380)
  }, [tiles])
  const shown = [...tiles, ...ghosts.filter((g) => !tiles.some((t) => t.id === g.id))]

  // ---------- jogos (poker, golfe, xadrez, damas, Magnata, truco, batalha naval, Mistério e sinuca) ----------
  const gameId = game.lobby?.gameId
  const view = gameId === 'poker' && game.view ? (game.view as PokerView) : null
  const golfView = gameId === 'golf' && game.view ? (game.view as GolfView) : null
  const chessView = gameId === 'chess' && game.view ? (game.view as ChessView) : null
  const checkersView = gameId === 'checkers' && game.view ? (game.view as CheckersView) : null
  const tycoonView = gameId === 'tycoon' && game.view ? (game.view as TycoonView) : null
  const trucoView = gameId === 'truco' && game.view ? (game.view as TrucoView) : null
  const navalView = gameId === 'naval' && game.view ? (game.view as NavalView) : null
  const mysteryView = gameId === 'mystery' && game.view ? (game.view as MysteryView) : null
  const stopView = gameId === 'stop' && game.view ? (game.view as StopView) : null
  const poolView = gameId === 'pool' && game.view ? (game.view as PoolView) : null
  const poolRef = useRef(poolView)
  poolRef.current = poolView
  const navalRef = useRef(navalView)
  navalRef.current = navalView
  const trucoRef = useRef(trucoView)
  trucoRef.current = trucoView
  const tycoonRef = useRef(tycoonView)
  tycoonRef.current = tycoonView
  const shooterView = gameId === 'shooter' && game.view ? (game.view as ShooterView) : null
  const shooterBus = useMemo(() => createSfxBus(), [])
  const [shooterTrack, setShooterTrack] = useState<MusicTrack | null>(null)
  /** jogo de tabuleiro para dois (xadrez ou damas) */
  const duelView = chessView ?? checkersView
  const [sceneSfx, setSceneSfx] = useState<{ name: SfxName; n: number } | null>(null)
  const onGolfSfx = useCallback((name: SfxName) => setSceneSfx((s) => ({ name, n: (s?.n ?? 0) + 1 })), [])
  const golfRef = useRef(golfView)
  golfRef.current = golfView
  const seated = !!game.lobby?.seats.some((x) => x.you)
  const [panelOpen, setPanelOpen] = useState(false)
  const [showTable, setShowTable] = useState(true)
  const [handsOpen, setHandsOpen] = useState(false)
  const [hi, setHi] = useState<string | null>(null)
  const [rects, setRects] = useState<Rect[]>([])
  const [musicOn, setMusicOn] = useState(() => getPrefs().musicOn)
  const [musicVolume, setMusicVolume] = useState(() => getPrefs().musicVolume)
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const [inviteSeq, setInviteSeq] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const ghostStyles = useRef(new Map<string, CSSProperties>())
  const narrow = useMedia('(max-width: 700px) and (orientation: portrait)')
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)')
  const tableMode = (!!view || !!golfView || !!duelView || !!tycoonView || !!trucoView || !!shooterView || !!navalView || !!mysteryView || !!poolView || !!stopView) && showTable
  const hiTile = tableMode && hi && tiles.some((t) => t.id === hi) ? hi : null
  const layout: SceneLayout = hiTile ? 'faixa' : 'mesa'
  const hasView = !!game.view

  useEffect(() => {
    if (hasView) {
      setShowTable(true)
      setPanelOpen(false)
    } else {
      setHi(null)
      setHandsOpen(false)
    }
  }, [hasView])
  useEffect(() => {
    if (!game.lobby) setDismissedFor(null)
  }, [game.lobby])
  const inviteVisible = shouldInvite(game.lobby, seated, name, dismissedFor)
  const wasInvite = useRef(false)
  useEffect(() => {
    if (inviteVisible && !wasInvite.current) setInviteSeq((n) => n + 1)
    wasInvite.current = inviteVisible
  }, [inviteVisible])
  useEffect(() => {
    if (gameError) toast(gameError.message, 'warn')
  }, [gameError, toast])

  const colorSource = view?.seats ?? golfView?.players ?? (duelView ? [duelView.white, duelView.black] : undefined) ?? tycoonView?.players ?? trucoView?.players ?? navalView?.players ?? mysteryView?.players ?? poolView?.players ?? stopView?.players
  const colors = useMemo(() => Object.fromEntries((colorSource ?? []).map((x) => [x.playerId, toneOf(x.name)])), [colorSource])
  const onGolfShot = useCallback(
    (angle: number, power: number) => {
      const v = golfRef.current
      const me = v?.players.find((p) => p.playerId === v.you?.playerId)
      if (!v || !me) return
      gameApi.act({ type: 'shot', hole: v.hole, stroke: me.strokes, angle, power })
    },
    [gameApi]
  )
  const onChessMove = useCallback(
    (from: string, to: string, promo?: Promo) => gameApi.act({ type: 'move', from, to, ...(promo ? { promo } : {}) } satisfies ChessAction),
    [gameApi]
  )
  const onCheckersMove = useCallback((path: string[]) => gameApi.act({ type: 'move', path } satisfies CheckersAction), [gameApi])
  /** tacada da sinuca: vai com o número de tacadas que a pessoa viu (`ref`) */
  const onPoolShoot = useCallback(
    (shot: PoolShot) => {
      const v = poolRef.current
      if (v) gameApi.act({ type: 'shoot', ...shot, ref: v.ref } satisfies PoolAction)
    },
    [gameApi]
  )
  const onMysteryAct = useCallback((a: MysteryAction) => gameApi.act(a), [gameApi])
  const onStopAct = useCallback((a: StopAction) => gameApi.act(a), [gameApi])
  const onNavalPlace = useCallback((ships: Placement[]) => gameApi.act({ type: 'place', ships } satisfies NavalAction), [gameApi])
  /** tiro da batalha naval: vai com o número de tiros que a pessoa viu (`ref`) */
  const onNavalShoot = useCallback(
    (cells: Cell[]) => {
      const v = navalRef.current
      if (v) gameApi.act({ type: 'shoot', cells, ref: v.ref } satisfies NavalAction)
    },
    [gameApi]
  )
  /** ação do truco: vai com a versão da sua mesa (`ref`), para clique atrasado não valer */
  const onTrucoAct = useCallback(
    (a: TrucoIntent) => {
      const v = trucoRef.current
      const m = v?.mesas.find((x) => x.id === v.myMesa)
      if (m) gameApi.act({ ...a, ref: m.ref } as TrucoAction)
    },
    [gameApi]
  )
  const onTrucoPlay = useCallback((card: string) => onTrucoAct({ type: 'play', card }), [onTrucoAct])
  /** clique numa casa do Magnata: vale quando o jogo pede para escolher (festival ou avião) */
  const onTycoonPick = useCallback(
    (tile: number) => {
      const kind = tycoonRef.current?.pending?.kind
      if (kind === 'festival' || kind === 'voar') gameApi.act({ type: kind === 'festival' ? 'festival' : 'fly', tile } satisfies TycoonAction)
    },
    [gameApi]
  )
  const onTvRects = useCallback((r: Rect[]) => setRects((prev) => (sameRects(prev, r) ? prev : r)), [])
  const tilesRef2 = useRef(tiles)
  tilesRef2.current = tiles
  const onTvClick = useCallback((i: number) => {
    const t = tilesRef2.current[i]
    if (t) setHi((h) => (h === t.id ? null : t.id))
  }, [])
  /** G no tiro: a tela em destaque vira o palco e o jogo vira miniatura (e volta) */
  const onShooterSpotlight = useCallback(() => {
    const hovered = document.querySelector<HTMLElement>('[data-tile-id]:hover')?.dataset.tileId
    setHi((h) => (h ? null : (hovered ?? tilesRef2.current[0]?.id ?? null)))
  }, [])
  const toggleMusic = (on: boolean) => {
    setMusicOn(on)
    setPrefs({ musicOn: on })
  }
  const changeMusicVolume = (v: number) => {
    setMusicVolume(v)
    setPrefs({ musicVolume: v })
  }
  const tableFor = (id: string, idx: number): { mode: 'rect' | 'hi' | 'strip' | 'parked'; style?: CSSProperties } | undefined => {
    if (!tableMode) return undefined
    if (hiTile) return { mode: id === hiTile ? 'hi' : 'parked' }
    if (narrow) return { mode: 'strip' }
    if (golfView || duelView || tycoonView || trucoView || shooterView || navalView || mysteryView || poolView || stopView) {
      const style = { right: CORNER_TV.edge, top: CORNER_TV.edge + idx * (CORNER_TV.h + CORNER_TV.gap), width: CORNER_TV.w, height: CORNER_TV.h }
      return { mode: 'rect', style }
    }
    const r = idx < tiles.length ? rects[idx] : undefined
    if (r) {
      const style = { left: r.x, top: r.y, width: r.w, height: r.h }
      ghostStyles.current.set(id, style)
      return { mode: 'rect', style }
    }
    const g = ghostStyles.current.get(id)
    return g ? { mode: 'rect', style: g } : { mode: 'parked' }
  }

  const peerById = (id: string) => state.peers.find((p) => p.id === id)
  const viewers = state.peers.length

  const toggleSidebar = () => {
    const next = !sidebarOpen
    setSidebarOpen(next)
    setPrefs({ sidebarOpen: next })
  }
  const toggleSounds = () => {
    const next = !soundsOn
    setSoundsOn(next)
    setPrefs({ sounds: next })
    if (next) playShareOn() // amostra: confirma que o som está ligado
  }

  const [browserAudio, setBrowserAudio] = useState(() => getPrefs().shareBrowserAudio)
  const toggleBrowserAudio = () => {
    const next = !browserAudio
    setBrowserAudio(next)
    setPrefs({ shareBrowserAudio: next })
    const later = state.screen ? ' Vale no próximo compartilhamento.' : ''
    if (next) {
      toast(
        `O som do navegador vai junto ao compartilhar a tela inteira. A voz dos amigos também vai e eles podem se ouvir de volta.${later}`,
        'warn',
        9000
      )
    } else toast(`O som do navegador fica de fora do compartilhamento.${later}`, 'info')
  }

  // ---------- chat do canal ----------
  const [chatMode, setChatMode] = useState<ChatMode>(() => getPrefs().chatMode)
  const chatBefore = useRef<Exclude<ChatMode, 'cheio'>>('coluna')
  const [chatDraft, setChatDraft] = useState('')
  const [seenLive, setSeenLive] = useState(0)
  const changeChatMode = (mode: ChatMode) => {
    setChatMode(mode)
    // "cheio" é passageiro: ao recarregar volta como coluna
    setPrefs({ chatMode: mode === 'cheio' ? 'coluna' : mode })
  }
  const toggleChatFull = () => {
    if (chatMode === 'cheio') return changeChatMode(chatBefore.current)
    chatBefore.current = chatMode === 'fechado' ? 'fechado' : 'coluna'
    changeChatMode('cheio')
  }
  useEffect(() => {
    if (chatMode !== 'fechado') setSeenLive(state.chatLive)
  }, [chatMode, state.chatLive])
  const unread = chatMode === 'fechado' ? Math.max(0, state.chatLive - seenLive) : 0
  const channelName = state.settings.channels.find((c) => c.id === state.channelId)?.name ?? 'Geral'
  const chatPanel =
    chatMode === 'fechado' ? null : (
      <ChatPanel
        channelName={channelName}
        messages={state.chat}
        selfId={state.selfId}
        mode={chatMode}
        draft={chatDraft}
        onDraft={setChatDraft}
        onSend={roomApi.sendChat}
        onClose={() => changeChatMode('fechado')}
        onToggleFull={toggleChatFull}
      />
    )

  const changeShowStats = (next: boolean) => {
    setShowStats(next)
    setPrefs({ showStats: next })
  }
  const health = signalHealth(state.peers, state.sendDiag)
  const changeSink = (id: string) => {
    setSinkId(id)
    setPrefs({ sinkId: id })
  }
  const effectiveSink = outputs.some((d) => d.deviceId === sinkId) ? sinkId : 'default'
  useEffect(() => setSoundSink(effectiveSink), [effectiveSink])

  // atalhos: M = mic, C = câmera, F = tela cheia, Ctrl+Alt+S = sinal, Esc = sair do foco
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles
  const tableModeRef = useRef(tableMode)
  tableModeRef.current = tableMode
  const panelOpenRef = useRef(panelOpen)
  panelOpenRef.current = panelOpen
  const signalRef = useRef(signalOpen)
  signalRef.current = signalOpen
  const toggleCameraRef = useRef(toggleCamera)
  toggleCameraRef.current = toggleCamera
  const canCamRef = useRef(canCam)
  canCamRef.current = canCam
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.closest('[role="listbox"]'))) return
      if (tourActive()) return
      if (controlling) return // as teclas vão para o PC controlado
      // Ctrl+Alt+S abre o sinal. Pelo `code` (tecla física): no teclado ABNT2, Ctrl+Alt vira AltGr e muda o `key`.
      // Não é S sozinho porque o S anda para baixo no Tiro na Sala.
      if (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyS') {
        e.preventDefault()
        setSignalOpen((o) => !o)
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (panelOpenRef.current) return
      const k = e.key.toLowerCase()
      // o painel do sinal fica por cima do palco: o Esc fecha ele antes da câmera maximizada
      if (k === 'escape' && signalRef.current) {
        e.preventDefault()
        setSignalOpen(false)
        return
      }
      if (k === 'escape' && pinnedRef.current && !document.fullscreenElement) {
        e.preventDefault()
        setPinnedCam(null)
        return
      }
      if (k === 'm') {
        e.preventDefault()
        void toggleMic()
      } else if (k === 'c' && canCamRef.current) {
        e.preventDefault()
        void toggleCameraRef.current()
      } else if (k === 'f') {
        // F age na tela selecionada (teclado), na que está sob o mouse ou na única que houver
        const active = document.activeElement?.closest<HTMLElement>('[data-tile-id]')
        const hovered = document.querySelector<HTMLElement>('[data-tile-id]:hover')
        const single =
          tilesRef.current.length === 1
            ? document.querySelector<HTMLElement>(`[data-tile-id="${CSS.escape(tilesRef.current[0].id)}"]`)
            : null
        // na mesa, F leva o palco inteiro para tela cheia (a TV sozinha: duplo clique ou botão)
        const el = tableModeRef.current ? bodyRef.current : (active ?? hovered ?? single)
        if (el) {
          e.preventDefault()
          toggleFullscreen(el)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleMic, controlling])

  // atalhos da mesa: P passar/pagar, A aumentar, D desistir, H tabela de mãos, G destaque da TV, Esc
  const myTurn = !!view && !!game.me && view.toAct === game.me
  useEffect(() => {
    if (!tableMode || !view) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.closest('[role="listbox"]'))) return
      if (e.ctrlKey || e.metaKey || e.altKey || panelOpen || tourActive() || controlling) return
      const k = e.key.toLowerCase()
      if (k === 'h') {
        e.preventDefault()
        setHandsOpen((o) => !o)
      } else if (k === 'g') {
        e.preventDefault()
        const hovered = document.querySelector<HTMLElement>('[data-tile-id]:hover')?.dataset.tileId
        setHi((h) => (h ? null : (hovered ?? tilesRef.current[0]?.id ?? null)))
      } else if (k === 'escape') {
        if (pinnedRef.current || signalRef.current) return
        if (handsOpen) setHandsOpen(false)
        else if (hi && !document.fullscreenElement) setHi(null)
      } else if (myTurn) {
        const a = shortcutAction(k, view.legal)
        if (a) {
          e.preventDefault()
          gameApi.act(a)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tableMode, view, panelOpen, controlling, handsOpen, hi, myTurn, gameApi])

  if (state.status === 'conectando' || state.status === 'aguardando-aprovacao' || state.status === 'erro') {
    return (
      <main className="center">
        <div className="wait">
          <div className="scene" aria-hidden="true">
            <Jan pose={state.status === 'erro' ? 'idle' : 'walk'} size={120} />
            <TvOff noise={state.status !== 'erro'} />
          </div>
          <h1>
            {state.status === 'conectando' && 'Entrando na sala…'}
            {state.status === 'aguardando-aprovacao' && 'Esperando quem criou a sala deixar você entrar'}
            {state.status === 'erro' && 'Não deu para entrar'}
          </h1>
          {state.error && <p className="error">{state.error}</p>}
          <div className="modal-actions">
            {state.status === 'erro' && <button onClick={reconnect}>Tentar de novo</button>}
            <button onClick={onLeave}>Voltar ao início</button>
          </div>
        </div>
      </main>
    )
  }

  const autoNow = isAuto(state.preset) && state.sendDiag?.mode === 'auto' ? state.sendDiag.levelLabel : undefined
  const qualityOptions: DropdownOption[] = [
    {
      value: AUTO_PRESET.id,
      label: AUTO_PRESET.label,
      short: 'Automático',
      sub: autoNow ? `Agora em ${autoNow}. Sobe e desce sozinha.` : 'Sobe e desce sozinha conforme a internet e o PC',
      icon: QUALITY_ICON[AUTO_PRESET.id]
    },
    ...PRESETS.map((p) => ({
      value: p.id,
      label: p.label.replace(/\s*\(.*\)\s*$/, ''),
      sub: `até ${p.height}p, ${p.fps} fps, ~${Math.round(bitrateFor(p, Math.max(viewers, 1)) / 1_000_000)} Mbps por pessoa`,
      icon: QUALITY_ICON[p.id]
    }))
  ]
  const qualityCurrent = qualityOptions.find((o) => o.value === state.preset.id)
  const qualityShown = autoNow ? `Automático · ${autoNow}` : (qualityCurrent?.short ?? qualityCurrent?.label)
  const outputOptions: DropdownOption[] = outputs.map((d) => ({
    value: d.deviceId,
    label: d.label || 'Saída de áudio',
    sub: d.deviceId === 'default' ? 'Padrão do sistema' : 'Dispositivo de saída',
    icon: 'speaker'
  }))
  const micDisabled = !state.micAvailable
  const request = state.requests[0]

  return (
    <div className={`room ${sidebarOpen ? '' : 'collapsed'} ${control.controlled.phase === 'active' ? 'has-banner' : ''}`}>
      {control.controlled.phase === 'active' && controlledBy && <ControlBanner name={controlledBy} onStop={control.stop} />}
      <aside className="sidebar">
        <div className="sidebar-inner">
          <div className="sidebar-head">
            <button className="brand-home" onClick={onLeave} data-tip="Voltar ao início" data-tip-pos="bottom" aria-label="Voltar ao início">
              <Brand />
            </button>
            <div className="head-actions">
              <button className="icon-btn" onClick={runTour} data-tip="Ver o tour" data-tip-pos="bottom" aria-label="Ver o tour">
                <Icon name="help" size={20} />
              </button>
              <button
                className="icon-btn"
                onClick={toggleSidebar}
                data-tip="Recolher barra lateral"
                data-tip-pos="left"
                aria-label="Recolher barra lateral"
              >
                <Icon name="panel" size={20} />
              </button>
            </div>
          </div>

          <ServerCard name={state.settings.name} isHost={state.isHost} onRename={roomApi.renameRoom} onCopy={() => void copy()} />

          <ChannelList
            settings={state.settings}
            channelId={state.channelId}
            isHost={state.isHost}
            self={{
              name,
              stream: state.micStream,
              muted: micMuted || !state.micStream
            }}
            peers={state.peers}
            roster={state.roster}
            detailFor={(p) => (showStats ? `Conexão: ${routeInfo(p)}` : undefined)}
            volumeFor={(who) => vol('mic', who)}
            onVolume={(who, v) => setVol('mic', who, v)}
            onJoin={roomApi.joinChannel}
            onCreate={roomApi.createChannel}
            onEdit={roomApi.editChannel}
            onDelete={roomApi.deleteChannel}
          />

          <OtherRooms rooms={otherRooms} onOpen={onOpenRoom} />

          {/* controle remoto e downloads ficam no pé da barra (os canais ganham o espaço de cima) */}
          <div className="sidebar-foot">
            <ControlSection
              helper={control.helper}
              onConnect={control.connectHelper}
              onDisconnect={control.disconnectHelper}
              onPair={control.pairHelper}
            />
            <DownloadBox />
          </div>
        </div>
      </aside>

      {/* áudio das vozes fica fora da barra, que pode estar recolhida */}
      <div className="audios" hidden>
        {state.peers.map((p) =>
          p.mic ? <RemoteAudio key={p.id} stream={p.mic} volume={vol('mic', p.name)} sinkId={effectiveSink} /> : null
        )}
      </div>

      <main className="stage">
        {!sidebarOpen && (
          <button
            className="icon-btn float-toggle"
            onClick={toggleSidebar}
            data-tip={`Mostrar barra lateral (${state.roster.length + 1} na sala)`}
            data-tip-pos="bottom"
            aria-label="Mostrar barra lateral"
          >
            <Icon name="panel" size={20} />
          </button>
        )}

        {audioBlocked && (
          <div className="banner sound-blocked" role="status">
            <Icon name="speaker" size={18} />
            <span>O navegador pausou o som da sala. Clique em qualquer lugar para ouvir.</span>
          </div>
        )}
        {state.status === 'caiu' && (
          <div className="banner">
            <span>{state.error ?? 'A conexão com a sala caiu.'}</span>
            <button onClick={reconnect}>Reconectar</button>
          </div>
        )}

        {chatMode === 'fechado' && (
          <button className="float-chat" onClick={() => changeChatMode('coluna')} aria-label={unread ? `Abrir chat, ${unread} mensagens novas` : 'Abrir chat'}>
            <Icon name="chat" size={18} />
            <span>Chat</span>
            {unread > 0 && <i className="badge">{unread > 99 ? '99+' : unread}</i>}
          </button>
        )}

        <div className="stage-body" ref={bodyRef}>
          <div className={`stage-area ${tableMode ? `table-area ${hiTile ? 'has-hi' : ''} ${narrow ? 'narrow' : ''}` : ''} ${pinnedItem ? 'has-pin' : ''}`}>
            {tableMode && view && (
              <div className="scene-host">
                <Suspense
                  fallback={
                    <div className="scene-loading">
                      <TvOff noise />
                    </div>
                  }
                >
                  <PokerSceneLazy
                    view={view}
                    lastEvents={game.lastEvents as EventBatch | null}
                    me={game.me}
                    colors={colors}
                    tvCount={tiles.length}
                    layout={layout}
                    reducedMotion={reducedMotion}
                    onTvRects={onTvRects}
                    onTvClick={onTvClick}
                  />
                </Suspense>
              </div>
            )}
            {tableMode && golfView && (
              <div className="scene-host golf-host">
                <Suspense
                  fallback={
                    <div className="scene-loading">
                      <TvOff noise />
                    </div>
                  }
                >
                  <GolfSceneLazy
                    view={golfView}
                    me={game.me}
                    colors={colors}
                    reducedMotion={reducedMotion}
                    onShot={onGolfShot}
                    onSfx={onGolfSfx}
                  />
                </Suspense>
              </div>
            )}
            {shooterView && (
              <Suspense fallback={null}>
                <ShooterStageLazy
                  view={shooterView}
                  manager={state.manager}
                  relay={gameApi.relay}
                  onRelay={gameApi.onRelay}
                  act={gameApi.act}
                  visible={tableMode}
                  pip={!!hiTile}
                  canManage={!!game.lobby?.canManage}
                  reducedMotion={reducedMotion}
                  sfxBus={shooterBus}
                  onTrack={setShooterTrack}
                  onPlayAgain={() => {
                    const options = game.lobby?.options
                    gameApi.close()
                    gameApi.open('shooter', options)
                  }}
                  onClose={gameApi.close}
                  onBackToScreens={() => setShowTable(false)}
                  onSpotlight={onShooterSpotlight}
                  musicOn={musicOn}
                  musicVolume={musicVolume}
                  onMusicOn={toggleMusic}
                  onMusicVolume={changeMusicVolume}
                />
              </Suspense>
            )}
            {tableMode && chessView && (
              <div className="scene-host chess-host">
                <Suspense
                  fallback={
                    <div className="scene-loading">
                      <TvOff noise />
                    </div>
                  }
                >
                  <ChessSceneLazy view={chessView} colors={colors} reducedMotion={reducedMotion} onMove={onChessMove} />
                </Suspense>
              </div>
            )}
            {tableMode && checkersView && (
              <div className="scene-host chess-host">
                <Suspense
                  fallback={
                    <div className="scene-loading">
                      <TvOff noise />
                    </div>
                  }
                >
                  <CheckersSceneLazy view={checkersView} colors={colors} reducedMotion={reducedMotion} onMove={onCheckersMove} />
                </Suspense>
              </div>
            )}
            {tableMode && tycoonView && (
              <div className="scene-host chess-host">
                <Suspense
                  fallback={
                    <div className="scene-loading">
                      <TvOff noise />
                    </div>
                  }
                >
                  <TycoonSceneLazy view={tycoonView} reducedMotion={reducedMotion} onPick={onTycoonPick} />
                </Suspense>
              </div>
            )}
            {tableMode && trucoView && (
              <div className="scene-host chess-host">
                <Suspense
                  fallback={
                    <div className="scene-loading">
                      <TvOff noise />
                    </div>
                  }
                >
                  <TrucoSceneLazy view={trucoView} lastEvents={game.lastEvents} reducedMotion={reducedMotion} onPlay={onTrucoPlay} />
                </Suspense>
              </div>
            )}
            {tableMode && navalView && (
              <div className="scene-host chess-host">
                <Suspense
                  fallback={
                    <div className="scene-loading">
                      <TvOff noise />
                    </div>
                  }
                >
                  <NavalSceneLazy view={navalView} reducedMotion={reducedMotion} onPlace={onNavalPlace} onShoot={onNavalShoot} />
                </Suspense>
              </div>
            )}
            {tableMode && poolView && (
              <div className="scene-host chess-host">
                <Suspense
                  fallback={
                    <div className="scene-loading">
                      <TvOff noise />
                    </div>
                  }
                >
                  <PoolSceneLazy view={poolView} reducedMotion={reducedMotion} onShoot={onPoolShoot} onSfx={onGolfSfx} />
                </Suspense>
              </div>
            )}
            {tableMode && stopView && (
              <div className="scene-host chess-host">
                <Suspense
                  fallback={
                    <div className="scene-loading">
                      <TvOff noise />
                    </div>
                  }
                >
                  <StopSceneLazy view={stopView} onAct={onStopAct} />
                </Suspense>
              </div>
            )}
            {tableMode && mysteryView && (
              <div className="scene-host chess-host">
                <Suspense
                  fallback={
                    <div className="scene-loading">
                      <TvOff noise />
                    </div>
                  }
                >
                  <MysterySceneLazy view={mysteryView} reducedMotion={reducedMotion} onAct={onMysteryAct} />
                </Suspense>
              </div>
            )}
            {camItems.length > 0 && (
              <CamStrip
                items={camItems}
                mode={tableMode ? 'flutuante' : shown.length === 0 && !pinnedItem ? 'palco' : 'faixa'}
                pinned={pinnedItem ? pinnedItem.id : null}
                onPin={pinCam}
              />
            )}
            {pinnedItem && <CamFocus key={pinnedItem.id} item={pinnedItem} onClose={() => setPinnedCam(null)} />}
            {!tableMode && shown.length === 0 && camItems.length === 0 && (
              <div className="empty" data-tour="stage">
                <div className="scene" aria-hidden="true">
                  <Jan pose="wait" size={144} />
                  <TvOff />
                </div>
                <h2>Ninguém está compartilhando.</h2>
                {canShare ? (
                  <button className="primary big" onClick={() => void share()}>
                    Compartilhar minha tela
                  </button>
                ) : (
                  <p className="muted">Este navegador só assiste. Para compartilhar, use o Chrome ou o Edge no PC.</p>
                )}
              </div>
            )}
            {/* as TVs ficam sempre neste mesmo lugar da árvore: trocar entre grade e mesa só muda a classe, sem remontar o vídeo */}
            <div
              data-tour={tableMode ? undefined : 'stage'}
              className={tableMode ? `tv-layer ${hiTile ? 'has-hi' : ''}` : `grid n${Math.min(shown.length, 4)}`}
            >
              {shown.map((t, i) => {
                const leaving = !tiles.some((x) => x.id === t.id)
                const peer = t.local ? undefined : peerById(t.id)
                const who = peer?.name ?? t.label
                return (
                  <VideoTile
                    key={t.id}
                    id={t.id}
                    stream={t.stream}
                    name={who}
                    local={t.local}
                    leaving={leaving}
                    volume={t.local ? 1 : vol('screen', who)}
                    onVolume={t.local ? undefined : (v) => setVol('screen', who, v)}
                    sinkId={effectiveSink}
                    badge={showStats && peer ? routeInfo(peer) : undefined}
                    table={tableFor(t.id, i)}
                    onSelect={tableMode ? () => setHi((h) => (h === t.id ? null : t.id)) : undefined}
                    control={
                      t.local || leaving
                        ? undefined
                        : {
                            state: control.controller.phase !== 'idle' && control.controller.peer === t.id ? control.controller.phase : 'idle',
                            canRequest: control.controller.phase === 'idle',
                            onRequest: () => control.requestControl(t.id),
                            onRelease: control.release,
                            onInput: control.sendInput
                          }
                    }
                  />
                )
              })}
            </div>
          </div>
          {signalOpen && (
            <SignalPanel
              peers={state.peers}
              sendDiag={state.sendDiag}
              log={state.diagLog}
              me={name}
              showStats={showStats}
              onShowStats={changeShowStats}
              onClose={() => setSignalOpen(false)}
            />
          )}
          {tableMode && view && (
            <Suspense fallback={null}>
              <PokerHudLazy
                view={view}
                me={game.me}
                canManage={!!game.lobby?.canManage}
                onAct={gameApi.act}
                onPlayAgain={() => {
                  const options = view.options
                  gameApi.close()
                  gameApi.open('poker', options)
                }}
                onCloseTable={gameApi.close}
                onBackToScreens={() => setShowTable(false)}
                musicOn={musicOn}
                musicVolume={musicVolume}
                onMusicOn={toggleMusic}
                onMusicVolume={changeMusicVolume}
                handsOpen={handsOpen}
                onHands={setHandsOpen}
              />
            </Suspense>
          )}
          {tableMode && golfView && (
            <Suspense fallback={null}>
              <GolfHudLazy
                view={golfView}
                me={game.me}
                colors={colors}
                canManage={!!game.lobby?.canManage}
                onPlayAgain={() => {
                  const options = game.lobby?.options
                  gameApi.close()
                  gameApi.open('golf', options)
                }}
                onClose={gameApi.close}
                onBackToScreens={() => setShowTable(false)}
                musicOn={musicOn}
                musicVolume={musicVolume}
                onMusicOn={toggleMusic}
                onMusicVolume={changeMusicVolume}
              />
            </Suspense>
          )}
          {tableMode && chessView && (
            <Suspense fallback={null}>
              <ChessHudLazy
                view={chessView}
                canManage={!!game.lobby?.canManage}
                onAct={gameApi.act}
                onPlayAgain={() => {
                  const options = game.lobby?.options
                  gameApi.close()
                  gameApi.open('chess', options)
                }}
                onClose={gameApi.close}
                onBackToScreens={() => setShowTable(false)}
                musicOn={musicOn}
                musicVolume={musicVolume}
                onMusicOn={toggleMusic}
                onMusicVolume={changeMusicVolume}
              />
            </Suspense>
          )}
          {tableMode && checkersView && (
            <Suspense fallback={null}>
              <CheckersHudLazy
                view={checkersView}
                canManage={!!game.lobby?.canManage}
                onAct={gameApi.act}
                onPlayAgain={() => {
                  const options = game.lobby?.options
                  gameApi.close()
                  gameApi.open('checkers', options)
                }}
                onClose={gameApi.close}
                onBackToScreens={() => setShowTable(false)}
                musicOn={musicOn}
                musicVolume={musicVolume}
                onMusicOn={toggleMusic}
                onMusicVolume={changeMusicVolume}
              />
            </Suspense>
          )}
          {tableMode && tycoonView && (
            <Suspense fallback={null}>
              <TycoonHudLazy
                view={tycoonView}
                canManage={!!game.lobby?.canManage}
                onAct={gameApi.act}
                onPlayAgain={() => {
                  const options = game.lobby?.options
                  gameApi.close()
                  gameApi.open('tycoon', options)
                }}
                onClose={gameApi.close}
                onBackToScreens={() => setShowTable(false)}
                musicOn={musicOn}
                musicVolume={musicVolume}
                onMusicOn={toggleMusic}
                onMusicVolume={changeMusicVolume}
              />
            </Suspense>
          )}
          {tableMode && trucoView && (
            <Suspense fallback={null}>
              <TrucoHudLazy
                view={trucoView}
                canManage={!!game.lobby?.canManage}
                onAct={onTrucoAct}
                onPlayAgain={() => {
                  const options = game.lobby?.options
                  gameApi.close()
                  gameApi.open('truco', options)
                }}
                onClose={gameApi.close}
                onBackToScreens={() => setShowTable(false)}
                musicOn={musicOn}
                musicVolume={musicVolume}
                onMusicOn={toggleMusic}
                onMusicVolume={changeMusicVolume}
              />
            </Suspense>
          )}
          {tableMode && navalView && (
            <Suspense fallback={null}>
              <NavalHudLazy
                view={navalView}
                canManage={!!game.lobby?.canManage}
                onPlayAgain={() => {
                  const options = game.lobby?.options
                  gameApi.close()
                  gameApi.open('naval', options)
                }}
                onClose={gameApi.close}
                onBackToScreens={() => setShowTable(false)}
                musicOn={musicOn}
                musicVolume={musicVolume}
                onMusicOn={toggleMusic}
                onMusicVolume={changeMusicVolume}
              />
            </Suspense>
          )}
          {tableMode && poolView && (
            <Suspense fallback={null}>
              <PoolHudLazy
                view={poolView}
                canManage={!!game.lobby?.canManage}
                onPlayAgain={() => {
                  gameApi.close()
                  gameApi.open('pool', {})
                }}
                onClose={gameApi.close}
                onBackToScreens={() => setShowTable(false)}
                musicOn={musicOn}
                musicVolume={musicVolume}
                onMusicOn={toggleMusic}
                onMusicVolume={changeMusicVolume}
              />
            </Suspense>
          )}
          {tableMode && stopView && (
            <Suspense fallback={null}>
              <StopHudLazy
                view={stopView}
                canManage={!!game.lobby?.canManage}
                onPlayAgain={() => {
                  const options = game.lobby?.options
                  gameApi.close()
                  gameApi.open('stop', options)
                }}
                onClose={gameApi.close}
                onBackToScreens={() => setShowTable(false)}
                musicOn={musicOn}
                musicVolume={musicVolume}
                onMusicOn={toggleMusic}
                onMusicVolume={changeMusicVolume}
              />
            </Suspense>
          )}
          {tableMode && mysteryView && (
            <Suspense fallback={null}>
              <MysteryHudLazy
                view={mysteryView}
                canManage={!!game.lobby?.canManage}
                onPlayAgain={() => {
                  gameApi.close()
                  gameApi.open('mystery', {})
                }}
                onClose={gameApi.close}
                onBackToScreens={() => setShowTable(false)}
                musicOn={musicOn}
                musicVolume={musicVolume}
                onMusicOn={toggleMusic}
                onMusicVolume={changeMusicVolume}
              />
            </Suspense>
          )}
          {/* chat no lugar da tela: a tela continua montada (e tocando) por baixo */}
          {chatMode === 'cheio' && chatPanel}
        </div>

        {inviteVisible && game.lobby && (
          <GameInvite
            gameId={game.lobby.gameId}
            openedBy={game.lobby.openedBy}
            onSit={() => {
              gameApi.sit()
              setPanelOpen(true)
            }}
            onLater={() => setDismissedFor(game.lobby?.openedBy ?? null)}
          />
        )}

        <footer className="controls">
          <button
            data-tour="mic"
            className={`ctl mic ${micMuted ? 'is-muted' : 'is-live'}`}
            style={{ '--ring': mySpeaking ? 2 + Math.min(1, myLevel * 1.6) * 4 : 0 } as CSSProperties}
            disabled={micDisabled}
            onClick={() => void toggleMic()}
            data-tip={micDisabled ? (state.micError ?? 'Sem microfone') : `${micMuted ? 'Ligar mic' : 'Mutar'} (M)`}
            aria-label={micDisabled ? 'Sem mic' : micMuted ? 'Ligar mic' : 'Mutar'}
            aria-pressed={!micMuted}
          >
            <Icon name={micMuted || micDisabled ? 'micOff' : 'mic'} size={20} />
            <span className="lbl">{micDisabled ? 'Sem mic' : micMuted ? 'Ligar mic' : 'Mutar'}</span>
          </button>

          {canCam && (
            <button
              data-tour="camera"
              className={`ctl cam ${state.camera ? 'is-live' : ''}`}
              onClick={() => void toggleCamera()}
              disabled={state.cameraPending}
              data-tip={state.camera ? 'Desligar câmera (C)' : 'Ligar câmera (C)'}
              aria-pressed={!!state.camera}
            >
              <Icon name={state.camera ? 'camera' : 'cameraOff'} size={20} />
              <span className="lbl">{state.cameraPending ? 'Abrindo…' : 'Câmera'}</span>
            </button>
          )}

          {state.screen ? (
            <button className="danger" data-tour="share" onClick={stopShare}>
              <Icon name="stop" size={20} />
              <span className="lbl">Parar</span>
            </button>
          ) : (
            canShare && (
              <button className="primary" data-tour="share" onClick={() => void share()}>
                <Icon name="screen" size={20} />
                <span className="lbl">Compartilhar tela</span>
              </button>
            )
          )}

          {canShare && (
            <Dropdown
              placement="up"
              tour="quality"
              icon="sliders"
              ariaLabel="Qualidade"
              value={state.preset.id}
              options={qualityOptions}
              onChange={(v) => setPreset(presetById(v))}
              buttonText={
                <>
                  Qualidade <small>{qualityShown}</small>
                </>
              }
            />
          )}

          {canShare && (
            <button
              className={`icon-btn ${browserAudio ? 'on' : ''}`}
              onClick={toggleBrowserAudio}
              data-tip={browserAudio ? 'Tirar o som do navegador do compartilhamento' : 'Incluir o som do navegador no compartilhamento'}
              aria-label="Incluir som do navegador"
              aria-pressed={browserAudio}
            >
              <Icon name={browserAudio ? 'volume' : 'volume0'} size={20} />
            </button>
          )}

          {outputs.length > 1 && (
            <Dropdown
              placement="up"
              icon="speaker"
              ariaLabel="Saída de áudio"
              value={effectiveSink}
              options={outputOptions}
              onChange={changeSink}
              tip="Saída de áudio"
              buttonText="Saída de áudio"
            />
          )}

          <button className="ctl games" data-tour="games" onClick={() => setPanelOpen(true)} aria-haspopup="dialog">
            <Icon name="cards" size={20} />
            <span className="lbl">Jogos</span>
            {game.lobby && <i className="dot" role="img" aria-label="mesa aberta" />}
          </button>
          <button
            data-tour="sounds"
            className={`icon-btn ${soundsOn ? 'on' : ''}`}
            onClick={toggleSounds}
            data-tip={soundsOn ? 'Desligar sons de aviso' : 'Ligar sons de aviso'}
            aria-label="Sons de aviso"
            aria-pressed={soundsOn}
          >
            <Icon name={soundsOn ? 'bell' : 'bellOff'} size={20} />
          </button>
          <button
            data-tour="signal"
            className={`icon-btn sig-btn h-${health} ${signalOpen ? 'open' : ''}`}
            onClick={() => setSignalOpen((o) => !o)}
            data-tip="Sinal da conexão (Ctrl+Alt+S)"
            aria-label="Sinal da conexão"
            aria-pressed={signalOpen}
          >
            <SignalBars lit={LIT[health]} size={22} />
          </button>
          <button className="ctl copy" onClick={() => void copy()} data-tip="Copiar link da sala" aria-label="Copiar link da sala">
            <Icon name="link" size={20} />
            <span className="lbl">Copiar link</span>
          </button>

          <span className="spacer" />
          <button className="danger leave" onClick={onLeave} data-tip="Sair da sala" aria-label="Sair da sala">
            <Icon name="logout" size={20} />
            <span className="lbl">Sair</span>
          </button>
        </footer>
      </main>

      {chatMode === 'coluna' && chatPanel}

      {panelOpen && (
        <GamesPanel
          lobby={game.lobby}
          hasView={hasView}
          api={gameApi}
          onClose={() => setPanelOpen(false)}
          onShowTable={() => setShowTable(true)}
        />
      )}
      {game.lobby && (
        <GameAudioDriver
          gameId={game.lobby.gameId}
          seated={seated}
          watching={tableMode}
          started={game.lobby.started}
          lastEvents={game.lastEvents}
          sceneSfx={sceneSfx}
          soundsOn={soundsOn}
          musicOn={musicOn}
          musicVolume={musicVolume}
          inviteSeq={inviteSeq}
          sfxBus={shooterView ? shooterBus : null}
          track={shooterView ? shooterTrack : null}
          mics={[
            { id: 'me', stream: state.micStream, muted: micMuted },
            ...state.peers.map((p) => ({ id: p.id, stream: p.mic, muted: p.state.micMuted }))
          ]}
        />
      )}

      {askTour && !tourBusy && <TourPrompt onYes={runTour} onClose={() => setAskTour(false)} />}

      {request && (
        <div className="modal-backdrop">
          <div className="modal narrow" role="dialog" aria-modal="true" key={request.requestId}>
            <Avatar name={request.name} size={56} />
            <h2>{request.name} quer entrar na sala</h2>
            <p className="muted">Só aceite se você reconhece quem é.</p>
            {state.requests.length > 1 && <p className="small muted">Mais {state.requests.length - 1} esperando.</p>}
            <div className="modal-actions">
              <button className="danger" onClick={() => answerRequest(request.requestId, false)}>
                Recusar
              </button>
              <button className="primary" onClick={() => answerRequest(request.requestId, true)}>
                Deixar entrar
              </button>
            </div>
          </div>
        </div>
      )}

      {control.controlled.phase === 'asking' && controlledBy && (
        <ControlRequestModal
          key={control.controlled.peer}
          name={controlledBy}
          screen={state.screen}
          helper={control.helper}
          onConnect={control.connectHelper}
          onDisconnect={control.disconnectHelper}
          onPair={control.pairHelper}
          onAllow={control.allow}
          onRefuse={control.refuse}
        />
      )}
    </div>
  )
}
