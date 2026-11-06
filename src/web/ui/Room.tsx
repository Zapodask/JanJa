import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { roomUrl } from '../../shared/protocol'
import { useAudioLevel, useSpeaking } from '../audio'
import type { PeerView, Route } from '../rtc/PeerManager'
import { PRESETS, presetById, uploadEstimateMbps } from '../rtc/quality'
import { getPrefs, rememberRoom, setPrefs, volumeKey } from '../storage'
import { canShareScreen, useRoom } from '../useRoom'
import { Avatar } from './Avatar'
import { Brand, Loader } from './Brand'
import { Icon } from './icons'
import { RemoteAudio, toggleFullscreen, VideoTile, VolumeSlider } from './media'
import { useToast } from './Toasts'

const ROUTE_LABEL: Record<Route, string> = {
  conectando: 'conectando',
  direto: 'direto',
  relay: 'via relay',
  falhou: 'falhou'
}

function routeInfo(p: PeerView): string {
  const parts = [ROUTE_LABEL[p.route]]
  if (p.rttMs !== undefined) parts.push(`${p.rttMs} ms`)
  if (p.inKbps) parts.push(`${(p.inKbps / 1000).toFixed(1)} Mbps`)
  return parts.join(' · ')
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
  isHost,
  self,
  stream,
  muted,
  detail,
  volume,
  onVolume
}: {
  name: string
  isHost: boolean
  self?: boolean
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
          {self && <small className="muted"> (você)</small>}
          {isHost && (
            <small className="tag">
              <Icon name="crown" size={11} /> host
            </small>
          )}
        </strong>
        {detail && <small className="route muted">{detail}</small>}
        {onVolume && volume !== undefined && (
          <VolumeSlider value={volume} onChange={onVolume} label={`Volume da voz de ${name}`} />
        )}
      </div>
      <span className={`mic-state ${muted ? 'off' : 'on'}`} title={muted ? 'Mic desligado' : 'Mic ligado'}>
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
  const [focus, setFocus] = useState<string | null>(null)
  const [sinkId, setSinkId] = useState(() => getPrefs().sinkId)
  const [volumes, setVolumes] = useState<Record<string, number>>(() => getPrefs().volumes)
  const [sidebarOpen, setSidebarOpen] = useState(() => getPrefs().sidebarOpen)
  const [showStats, setShowStats] = useState(() => getPrefs().showStats)
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
    for (const [id, n] of now) if (!prev.has(id)) toast(`${n} entrou na sala`, 'ok')
    for (const [id, n] of prev) if (!now.has(id)) toast(`${n} saiu da sala`, 'info')
  }, [state.status, state.peers, toast])

  // erro do microfone vira aviso
  useEffect(() => {
    if (state.micError) toast(state.micError, 'error', 8000)
  }, [state.micError, toast])

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast('Link da sala copiado', 'ok')
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

  // se a tela em foco sumiu, volta para a grade
  const focusedTile = tiles.find((t) => t.id === focus)
  useEffect(() => {
    if (focus && !focusedTile) setFocus(null)
  }, [focus, focusedTile])

  const peerById = (id: string) => state.peers.find((p) => p.id === id)
  const viewers = state.peers.length

  const toggleSidebar = () => {
    const next = !sidebarOpen
    setSidebarOpen(next)
    setPrefs({ sidebarOpen: next })
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

  // atalhos: M = mic, F = tela cheia, Esc = sair do foco
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'm') {
        e.preventDefault()
        void toggleMic()
      } else if (k === 'f') {
        const id = focus ?? (tilesRef.current.length === 1 ? tilesRef.current[0].id : null)
        const el = id ? document.querySelector<HTMLElement>(`[data-tile-id="${CSS.escape(id)}"]`) : null
        if (el) {
          e.preventDefault()
          toggleFullscreen(el)
        }
      } else if (k === 'escape' && focus && !document.fullscreenElement) {
        setFocus(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus, toggleMic])

  if (state.status === 'conectando' || state.status === 'aguardando-aprovacao' || state.status === 'erro') {
    return (
      <main className="center">
        <div className="card narrow enter wait">
          <Brand />
          {state.status !== 'erro' && <Loader />}
          <h2>
            {state.status === 'conectando' && 'Entrando na sala...'}
            {state.status === 'aguardando-aprovacao' && 'Esperando quem criou a sala deixar você entrar...'}
            {state.status === 'erro' && 'Não deu para entrar'}
          </h2>
          {state.error && <p className="error">{state.error}</p>}
          <div className="modal-actions">
            {state.status === 'erro' && <button onClick={reconnect}>Tentar de novo</button>}
            <button onClick={onLeave}>Voltar ao início</button>
          </div>
        </div>
      </main>
    )
  }

  const micDisabled = !state.micAvailable
  const request = state.requests[0]
  const thumbs = focusedTile ? tiles.length - 1 : 0

  return (
    <div className={`room enter ${sidebarOpen ? '' : 'collapsed'}`}>
      <aside className="sidebar">
        <div className="sidebar-inner">
          <div className="sidebar-head">
            <Brand />
            <button className="icon-btn" onClick={toggleSidebar} title="Recolher barra lateral" aria-label="Recolher barra lateral">
              <Icon name="panel" size={18} />
            </button>
          </div>

          <section>
            <h3>Convide os amigos</h3>
            <button className="primary wide" onClick={() => void copy()}>
              <Icon name="link" size={16} /> Copiar link da sala
            </button>
            <p className="muted small">Quem abrir o link entra direto pelo navegador.</p>
          </section>

          <section>
            <h3>
              <Icon name="users" size={15} /> Na sala <span className="count">{state.peers.length + 1}</span>
            </h3>
            <ul className="people">
              <PersonRow
                name={name}
                isHost={state.isHost}
                self
                stream={state.micStream}
                muted={micMuted || !state.micStream}
              />
              {state.peers.map((p) => (
                <PersonRow
                  key={p.id}
                  name={p.name}
                  isHost={p.isHost}
                  stream={p.mic}
                  muted={p.state.micMuted}
                  detail={showStats ? routeInfo(p) : undefined}
                  volume={vol('mic', p.name)}
                  onVolume={(v) => setVol('mic', p.name, v)}
                />
              ))}
            </ul>
          </section>
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
          <button className="icon-btn float-toggle" onClick={toggleSidebar} title="Mostrar barra lateral" aria-label="Mostrar barra lateral">
            <Icon name="panel" size={18} />
            <span className="count">{state.peers.length + 1}</span>
          </button>
        )}

        {state.status === 'caiu' && (
          <div className="banner warn enter">
            <Icon name="warn" size={18} />
            <span>{state.error ?? 'A conexão com a sala caiu.'}</span>
            <button onClick={reconnect}>Reconectar</button>
          </div>
        )}

        {tiles.length === 0 ? (
          <div className="empty">
            <div className="art" aria-hidden="true">
              <span className="ring r1" />
              <span className="ring r2" />
              <span className="ring r3" />
              <div className="monitor">
                <Icon name="screen" size={44} />
              </div>
              <i className="orb a" />
              <i className="orb b" />
              <i className="orb c" />
            </div>
            <h2>Ninguém está compartilhando a tela ainda</h2>
            {canShare ? (
              <>
                <p className="muted">Escolha uma tela, janela ou aba e os amigos assistem na hora.</p>
                <button className="primary big glow" onClick={() => void share()}>
                  <Icon name="screen" size={20} /> Compartilhar minha tela
                </button>
              </>
            ) : (
              <p className="muted small">Este navegador só assiste. Para compartilhar, use o Chrome ou o Edge no PC.</p>
            )}
          </div>
        ) : (
          <div
            className={`grid ${focusedTile ? 'has-focus' : `n${Math.min(tiles.length, 4)}`}`}
            style={{ '--thumbs': Math.max(thumbs, 1) } as CSSProperties}
          >
            {tiles.map((t, i) => {
              const peer = t.local ? undefined : peerById(t.id)
              return (
                <VideoTile
                  key={t.id}
                  id={t.id}
                  index={i}
                  stream={t.stream}
                  label={t.label}
                  local={t.local}
                  volume={t.local ? 1 : vol('screen', peer?.name ?? t.label)}
                  onVolume={t.local ? undefined : (v) => setVol('screen', peer?.name ?? t.label, v)}
                  sinkId={effectiveSink}
                  focused={focus === t.id}
                  thumb={!!focusedTile && focus !== t.id}
                  onFocus={() => setFocus(t.id)}
                  onToggleFocus={() => setFocus((f) => (f === t.id ? null : t.id))}
                  badge={showStats && peer ? routeInfo(peer) : undefined}
                />
              )
            })}
          </div>
        )}

        <footer className="dock">
          <button
            className={`dock-btn mic ${micMuted ? 'muted' : 'live'} ${mySpeaking ? 'speaking' : ''}`}
            style={{ '--lvl': mySpeaking ? Math.min(1, 0.2 + myLevel * 1.6) : 0 } as CSSProperties}
            disabled={micDisabled}
            onClick={() => void toggleMic()}
            title={micDisabled ? (state.micError ?? 'Sem microfone') : micMuted ? 'Ativar mic (M)' : 'Mutar mic (M)'}
            aria-pressed={!micMuted}
          >
            <Icon name={micMuted || micDisabled ? 'micOff' : 'mic'} size={20} />
            <span className="lbl">{micDisabled ? 'Sem mic' : micMuted ? 'Mic' : 'No ar'}</span>
          </button>

          {state.screen ? (
            <button className="dock-btn danger" onClick={stopShare} title="Parar de compartilhar">
              <Icon name="stop" size={20} />
              <span className="lbl">Parar</span>
            </button>
          ) : (
            canShare && (
              <button className="dock-btn accent" onClick={() => void share()} title="Compartilhar tela">
                <Icon name="screen" size={20} />
                <span className="lbl">Compartilhar</span>
              </button>
            )
          )}

          {canShare && (
            <label
              className="dock-select"
              title={`Qualidade · upload estimado ~${uploadEstimateMbps(state.preset, viewers).toFixed(1)} Mbps`}
            >
              <Icon name="spark" size={18} />
              <select value={state.preset.id} onChange={(e) => setPreset(presetById(e.target.value))} aria-label="Qualidade">
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <small className="est">~{uploadEstimateMbps(state.preset, viewers).toFixed(1)} Mbps</small>
            </label>
          )}

          {outputs.length > 1 && (
            <label className="dock-select compact" title="Saída de áudio da sala">
              <Icon name="speaker" size={18} />
              <select value={effectiveSink} onChange={(e) => changeSink(e.target.value)} aria-label="Saída de áudio">
                {outputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Saída de áudio'}
                  </option>
                ))}
              </select>
            </label>
          )}

          <span className="dock-sep" />

          <button
            className={`dock-btn ${showStats ? 'on' : ''}`}
            onClick={toggleStats}
            title={showStats ? 'Esconder estatísticas' : 'Mostrar estatísticas'}
            aria-pressed={showStats}
          >
            <Icon name="chart" size={20} />
          </button>
          <button className="dock-btn" onClick={() => void copy()} title="Copiar link da sala">
            <Icon name="link" size={20} />
          </button>
          <button className="dock-btn danger-soft" onClick={onLeave} title="Sair da sala">
            <Icon name="logout" size={20} />
          </button>
        </footer>
      </main>

      {request && (
        <div className="modal-backdrop">
          <div className="modal narrow" role="dialog" aria-modal="true" key={request.requestId}>
            <Avatar name={request.name} size={64} />
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
    </div>
  )
}
