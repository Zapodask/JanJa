import { useEffect, useMemo, useState } from 'react'
import { roomUrl } from '../../shared/protocol'
import type { PeerView, Route } from '../rtc/PeerManager'
import { PRESETS, presetById, uploadEstimateMbps } from '../rtc/quality'
import { canShareScreen, useRoom } from '../useRoom'
import { RemoteAudio, VideoTile } from './media'

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

interface Props {
  roomId: string
  name: string
  hostKey?: string
  onLeave: () => void
}

export function Room({ roomId, name, hostKey, onLeave }: Props) {
  const { state, toggleMic, startShare, stopShare, setPreset, answerRequest, reconnect } = useRoom(roomId, name, hostKey)
  const [focus, setFocus] = useState<string | null>(null)
  const [sinkId, setSinkId] = useState('default')
  const [volumes, setVolumes] = useState<Record<string, number>>({})
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState('')
  const outputs = useOutputDevices()
  const link = roomUrl(location.origin, roomId)
  const canShare = canShareScreen()

  // pedido de entrada aparece no título da aba, para o host ver mesmo em outra aba
  useEffect(() => {
    document.title = state.requests.length ? `(${state.requests.length}) Pedido de entrada · JanJa` : 'JanJa'
  }, [state.requests.length])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('Copie o link da sala:', link)
    }
  }

  const share = async () => {
    setNotice('')
    try {
      const { hasAudio } = await startShare(state.preset)
      if (!hasAudio) {
        setNotice(
          'Compartilhando sem som. Para enviar o áudio, compartilhe a tela inteira (ou uma aba) e marque "Compartilhar áudio".'
        )
      }
    } catch (err) {
      // cancelar o seletor do navegador não é erro
      if (err instanceof DOMException && err.name === 'NotAllowedError') return
      setNotice(`Não deu para compartilhar: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const tiles = useMemo(() => {
    const list: { id: string; label: string; stream: MediaStream; local?: boolean }[] = []
    if (state.screen) list.push({ id: 'me', label: `${name} (você)`, stream: state.screen, local: true })
    for (const p of state.peers) if (p.screen) list.push({ id: p.id, label: p.name, stream: p.screen })
    return list
  }, [state.screen, state.peers, name])

  const focusedTile = tiles.find((t) => t.id === focus)
  const visibleTiles = focusedTile ? [focusedTile] : tiles
  const vol = (id: string) => volumes[id] ?? 1
  const viewers = state.peers.length

  if (state.status === 'conectando' || state.status === 'aguardando-aprovacao' || state.status === 'erro') {
    return (
      <main className="center">
        <div className="card narrow">
          <h1 className="brand">JanJa</h1>
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

  return (
    <div className="room">
      <aside className="sidebar">
        <h1 className="brand">JanJa</h1>

        <section>
          <h3>Convide os amigos</h3>
          <button className="primary wide" onClick={() => void copy()}>
            {copied ? 'Link copiado!' : 'Copiar link da sala'}
          </button>
          <p className="muted small">Quem abrir o link entra direto pelo navegador.</p>
        </section>

        <section>
          <h3>Na sala ({state.peers.length + 1})</h3>
          <ul className="people">
            <li>
              <span className={`dot ${state.me.micMuted || !state.micAvailable ? 'off' : 'on'}`} />
              <div className="person">
                <strong>
                  {name} {state.isHost && <small className="tag">host</small>}
                </strong>
                <small className="muted">você</small>
              </div>
            </li>
            {state.peers.map((p) => (
              <li key={p.id}>
                <span className={`dot ${p.state.micMuted ? 'off' : 'on'}`} />
                <div className="person">
                  <strong>
                    {p.name} {p.isHost && <small className="tag">host</small>}
                  </strong>
                  <small className={`route ${p.route}`}>{routeInfo(p)}</small>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={vol(`mic:${p.id}`)}
                    onChange={(e) => setVolumes((v) => ({ ...v, [`mic:${p.id}`]: Number(e.target.value) }))}
                    title="Volume da voz"
                    aria-label={`Volume da voz de ${p.name}`}
                  />
                </div>
                {p.mic && <RemoteAudio stream={p.mic} volume={vol(`mic:${p.id}`)} sinkId={sinkId} />}
              </li>
            ))}
          </ul>
        </section>

        {state.status === 'caiu' && (
          <section className="warning">
            <p>{state.error ?? 'A conexão com a sala caiu.'}</p>
            <button onClick={reconnect}>Reconectar</button>
          </section>
        )}
      </aside>

      <main className="stage">
        {notice && (
          <div className="notice dismissible">
            <span>{notice}</span>
            <button onClick={() => setNotice('')} aria-label="Fechar aviso">
              ×
            </button>
          </div>
        )}

        {tiles.length === 0 ? (
          <div className="empty">
            <p>Ninguém está compartilhando a tela ainda.</p>
            {canShare ? (
              <button className="primary" onClick={() => void share()}>
                Compartilhar minha tela
              </button>
            ) : (
              <p className="muted small">Este navegador só assiste. Para compartilhar, use o Chrome ou o Edge no PC.</p>
            )}
          </div>
        ) : (
          <div className={`grid n${Math.min(visibleTiles.length, 4)}`}>
            {visibleTiles.map((t) => (
              <VideoTile
                key={t.id}
                stream={t.stream}
                label={t.label}
                local={t.local}
                volume={vol(`screen:${t.id}`)}
                sinkId={sinkId}
                focused={focus === t.id}
                onToggleFocus={() => setFocus((f) => (f === t.id ? null : t.id))}
                footer={
                  t.local ? null : (
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={vol(`screen:${t.id}`)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setVolumes((v) => ({ ...v, [`screen:${t.id}`]: Number(e.target.value) }))}
                      title="Volume da tela"
                      aria-label={`Volume da tela de ${t.label}`}
                    />
                  )
                }
              />
            ))}
          </div>
        )}

        <footer className="controls">
          <button className={state.me.micMuted ? 'danger' : ''} disabled={!state.micAvailable} onClick={toggleMic}>
            {!state.micAvailable ? 'Sem microfone' : state.me.micMuted ? 'Ativar mic' : 'Mutar mic'}
          </button>

          {state.screen ? (
            <button className="danger" onClick={stopShare}>
              Parar de compartilhar
            </button>
          ) : (
            canShare && (
              <button className="primary" onClick={() => void share()}>
                Compartilhar tela
              </button>
            )
          )}

          {canShare && (
            <select
              value={state.preset.id}
              onChange={(e) => setPreset(presetById(e.target.value))}
              title={`Qualidade · upload estimado ~${uploadEstimateMbps(state.preset, viewers).toFixed(1)} Mbps`}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}

          {outputs.length > 1 && (
            <select value={sinkId} onChange={(e) => setSinkId(e.target.value)} title="Saída de áudio da sala">
              {outputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'Saída de áudio'}
                </option>
              ))}
            </select>
          )}

          <span className="spacer" />
          <button className="danger" onClick={onLeave}>
            Sair
          </button>
        </footer>
      </main>

      {state.requests[0] && (
        <div className="modal-backdrop">
          <div className="modal narrow" role="dialog" aria-modal="true">
            <h2>{state.requests[0].name} quer entrar na sala</h2>
            <p className="muted">Só aceite se você reconhece quem é.</p>
            <div className="modal-actions">
              <button className="danger" onClick={() => answerRequest(state.requests[0].requestId, false)}>
                Recusar
              </button>
              <button className="primary" onClick={() => answerRequest(state.requests[0].requestId, true)}>
                Deixar entrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
