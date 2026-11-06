import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { roomUrl } from '../../shared/protocol'
import { useAudioLevel, useSpeaking } from '../audio'
import type { PeerView, Route } from '../rtc/PeerManager'
import { useControl } from '../control/useControl'
import { PRESETS, bitrateFor, presetById } from '../rtc/quality'
import { getPrefs, rememberRoom, setPrefs, volumeKey } from '../storage'
import { playDoorbell, playKnock, playShareOn, setSoundSink } from '../sounds'
import { canShareScreen, useRoom } from '../useRoom'
import { Avatar } from './Avatar'
import { ControlBanner, ControlRequestModal, ControlSection } from './Control'
import { Brand, TvOff } from './Brand'
import { Jan } from './Pixel'
import { Dropdown, type DropdownOption } from './Dropdown'
import { Icon, type IconName } from './icons'
import { RemoteAudio, toggleFullscreen, VideoTile, VolumeSlider } from './media'
import { useToast } from './Toasts'
import { startTour, stopTour, tourActive } from './tour'
import { ROOM_STEPS, shouldAskTour, shouldAutoTour } from './tourLogic'
import { TourPrompt } from './TourPrompt'

const ROUTE_LABEL: Record<Route, string> = {
  conectando: 'conectando',
  direto: 'direto',
  relay: 'via relay',
  falhou: 'falhou'
}

const QUALITY_ICON: Record<string, IconName> = { texto: 'panel', equilibrado: 'grid', jogo: 'screen', jogo60: 'focus' }

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

/** Linha de uma pessoa na barra lateral; quem fala ganha aura. */
function PersonRow({
  name,
  stream,
  muted,
  detail,
  volume,
  onVolume
}: {
  name: string
  stream?: MediaStream
  muted: boolean
  detail?: string
  volume?: number
  onVolume?: (v: number) => void
}) {
  const active = !muted && !!stream
  const speaking = useSpeaking(stream, active)
  const level = useAudioLevel(stream, active)
  return (
    <li className={`person ${speaking ? 'speaking' : ''}`}>
      <Avatar name={name} size={40} level={level} speaking={speaking} />
      <div className="person-body">
        <strong>
          {name}
        </strong>
        {detail && <small className="detail">{detail}</small>}
        {onVolume && volume !== undefined && (
          <VolumeSlider value={volume} onChange={onVolume} label={`Volume da voz de ${name}`} />
        )}
      </div>
      <span className={`mic-state ${muted ? 'off' : 'on'}`} data-tip={muted ? 'Mic desligado' : 'Mic ligado'} data-tip-pos="left">
        <Icon name={muted ? 'micOff' : 'mic'} size={15} />
      </span>
    </li>
  )
}

interface Props {
  roomId: string
  name: string
  hostKey?: string
  onLeave: () => void
}

export function Room({ roomId, name, hostKey, onLeave }: Props) {
  const { state, toggleMic, startShare, stopShare, setPreset, answerRequest, reconnect } = useRoom(roomId, name, hostKey)
  const toast = useToast()
  const control = useControl({ manager: state.manager, screen: state.screen, peers: state.peers, notify: toast })
  const controlling = control.controller.phase === 'active'
  const controlledPeer = control.controlled.phase === 'idle' ? undefined : control.controlled.peer
  const controlledBy = controlledPeer ? (state.peers.find((p) => p.id === controlledPeer)?.name ?? 'Alguém') : undefined
  const [sinkId, setSinkId] = useState(() => getPrefs().sinkId)
  const [volumes, setVolumes] = useState<Record<string, number>>(() => getPrefs().volumes)
  const [sidebarOpen, setSidebarOpen] = useState(() => getPrefs().sidebarOpen)
  const [showStats, setShowStats] = useState(() => getPrefs().showStats)
  const [soundsOn, setSoundsOn] = useState(() => getPrefs().sounds)
  const outputs = useOutputDevices()
  const link = roomUrl(location.origin, roomId)
  const canShare = canShareScreen()

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
  useEffect(() => {
    document.title = state.requests.length ? `(${state.requests.length}) Pedido de entrada · JanJa` : 'JanJa'
    return () => {
      document.title = 'JanJa'
    }
  }, [state.requests.length])

  // lembra a sala (e quem estava nela) para a lista de recentes
  const othersKey = state.peers.map((p) => p.name).join('\n')
  useEffect(() => {
    if (state.status !== 'na-sala') return
    rememberRoom({ roomId, people: othersKey ? othersKey.split('\n') : [], host: state.isHost })
  }, [state.status, state.isHost, roomId, othersKey])

  // avisos de quem entrou e saiu (o primeiro retrato da sala não gera aviso)
  const seen = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    if (state.status !== 'na-sala') {
      seen.current = null
      return
    }
    const now = new Map(state.peers.map((p) => [p.id, p.name]))
    const prev = seen.current
    seen.current = now
    if (!prev) return
    for (const [id, n] of now) if (!prev.has(id)) toast(`${n} entrou`, 'ok')
    for (const [id, n] of prev) if (!now.has(id)) toast(`${n} saiu`, 'info')
  }, [state.status, state.peers, toast])

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
          'Compartilhando sem som. Para enviar o áudio, compartilhe a tela inteira (ou uma aba) e marque "Compartilhar áudio".',
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

  const tiles = useMemo(() => {
    const list: { id: string; label: string; stream: MediaStream; local?: boolean }[] = []
    if (state.screen) list.push({ id: 'me', label: `${name} (você)`, stream: state.screen, local: true })
    for (const p of state.peers) if (p.screen) list.push({ id: p.id, label: p.name, stream: p.screen })
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

  const toggleStats = () => {
    const next = !showStats
    setShowStats(next)
    setPrefs({ showStats: next })
  }
  const changeSink = (id: string) => {
    setSinkId(id)
    setPrefs({ sinkId: id })
  }
  const effectiveSink = outputs.some((d) => d.deviceId === sinkId) ? sinkId : 'default'
  useEffect(() => setSoundSink(effectiveSink), [effectiveSink])

  // atalhos: M = mic, F = tela cheia, Esc = sair do foco
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.closest('[role="listbox"]'))) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (tourActive()) return
      if (controlling) return // as teclas vão para o PC controlado
      const k = e.key.toLowerCase()
      if (k === 'm') {
        e.preventDefault()
        void toggleMic()
      } else if (k === 'f') {
        // F age na tela selecionada (teclado), na que está sob o mouse ou na única que houver
        const active = document.activeElement?.closest<HTMLElement>('[data-tile-id]')
        const hovered = document.querySelector<HTMLElement>('[data-tile-id]:hover')
        const single =
          tilesRef.current.length === 1
            ? document.querySelector<HTMLElement>(`[data-tile-id="${CSS.escape(tilesRef.current[0].id)}"]`)
            : null
        const el = active ?? hovered ?? single
        if (el) {
          e.preventDefault()
          toggleFullscreen(el)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleMic, controlling])

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

  const qualityOptions: DropdownOption[] = PRESETS.map((p) => ({
    value: p.id,
    label: p.label.replace(/\s*\(.*\)\s*$/, ''),
    sub: `${p.height}p, ${p.fps} fps, ~${Math.round(bitrateFor(p, Math.max(viewers, 1)) / 1_000_000)} Mbps por pessoa`,
    icon: QUALITY_ICON[p.id]
  }))
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
            <Brand />
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

          <button className="wide" data-tour="copy-link" onClick={() => void copy()}>
            <Icon name="link" size={16} /> Copiar link da sala
          </button>

          <section data-tour="people">
            <h3>Na sala ({state.peers.length + 1})</h3>
            <ul className="people">
              <PersonRow
                name={name}
                detail={state.isHost ? 'você, criou a sala' : 'você'}
                stream={state.micStream}
                muted={micMuted || !state.micStream}
              />
              {state.peers.map((p) => (
                <PersonRow
                  key={p.id}
                  name={p.name}
                  stream={p.mic}
                  muted={p.state.micMuted}
                  detail={[p.isHost ? 'criou a sala' : '', showStats ? routeInfo(p) : ''].filter(Boolean).join(', ') || undefined}
                  volume={vol('mic', p.name)}
                  onVolume={(v) => setVol('mic', p.name, v)}
                />
              ))}
            </ul>
          </section>

          <ControlSection
            helper={control.helper}
            onConnect={control.connectHelper}
            onDisconnect={control.disconnectHelper}
            onPair={control.pairHelper}
          />
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
            data-tip={`Mostrar barra lateral (${state.peers.length + 1} na sala)`}
            data-tip-pos="bottom"
            aria-label="Mostrar barra lateral"
          >
            <Icon name="panel" size={20} />
          </button>
        )}

        {state.status === 'caiu' && (
          <div className="banner">
            <span>{state.error ?? 'A conexão com a sala caiu.'}</span>
            <button onClick={reconnect}>Reconectar</button>
          </div>
        )}

        {shown.length === 0 ? (
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
        ) : (
          <div
            data-tour="stage"
            className={`grid n${Math.min(shown.length, 4)}`}
          >
            {shown.map((t) => {
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
        )}

        <footer className="controls">
          <button
            data-tour="mic"
            className={`ctl mic ${micMuted ? 'is-muted' : 'is-live'}`}
            style={{ '--ring': mySpeaking ? 2 + Math.min(1, myLevel * 1.6) * 4 : 0 } as CSSProperties}
            disabled={micDisabled}
            onClick={() => void toggleMic()}
            data-tip={micDisabled ? (state.micError ?? 'Sem microfone') : 'Atalho: M'}
            aria-pressed={!micMuted}
          >
            <Icon name={micMuted || micDisabled ? 'micOff' : 'mic'} size={20} />
            <span className="lbl">{micDisabled ? 'Sem mic' : micMuted ? 'Ligar mic' : 'Mutar'}</span>
          </button>

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
                  Qualidade <small>{qualityOptions.find((o) => o.value === state.preset.id)?.label}</small>
                </>
              }
            />
          )}

          {outputs.length > 1 && (
            <Dropdown
              placement="up"
              icon="speaker"
              ariaLabel="Saída de áudio"
              value={effectiveSink}
              options={outputOptions}
              onChange={changeSink}
              buttonText="Saída de áudio"
            />
          )}

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
            className={`icon-btn stats-toggle ${showStats ? 'on' : ''}`}
            onClick={toggleStats}
            data-tip={showStats ? 'Esconder estatísticas' : 'Mostrar estatísticas'}
            aria-label="Estatísticas de conexão"
            aria-pressed={showStats}
          >
            <Icon name="chart" size={20} />
          </button>
          <button className="ctl" onClick={() => void copy()}>
            <Icon name="link" size={20} />
            <span className="lbl">Copiar link</span>
          </button>

          <span className="spacer" />
          <button className="danger" onClick={onLeave}>
            <Icon name="logout" size={20} />
            <span className="lbl">Sair</span>
          </button>
        </footer>
      </main>

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
