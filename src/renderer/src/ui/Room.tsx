import { useEffect, useMemo, useState } from 'react'
import type { JoinRequest } from '../../../preload/api'
import type { Session } from '../App'
import type { PeerView, Route } from '../rtc/PeerManager'
import { PRESETS } from '../rtc/quality'
import { useRoom } from '../useRoom'
import { RemoteAudio, VideoTile } from './media'
import { SourcePicker } from './SourcePicker'

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
    const refresh = () =>
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => setDevices(list.filter((d) => d.kind === 'audiooutput')))
        .catch(() => undefined)
    void refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [])
  return devices
}

export function Room({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const { state, toggleMic, startShare, stopShare, setPreset, reconnect } = useRoom(session.code, session.name)
  const [picking, setPicking] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  const [sinkId, setSinkId] = useState('default')
  const [volumes, setVolumes] = useState<Record<string, number>>({})
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const outputs = useOutputDevices()

  useEffect(
    () =>
      session.hosted ? window.janja.onJoinRequest((req) => setRequests((list) => [...list, req])) : undefined,
    [session.hosted]
  )

  const answer = (req: JoinRequest, ok: boolean) => {
    window.janja.respondJoin(req.requestId, ok)
    setRequests((list) => list.filter((r) => r.requestId !== req.requestId))
  }

  const copy = async (code: string) => {
    await navigator.clipboard.writeText(code)
    setCopied(code)
    setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500)
  }

  const tiles = useMemo(() => {
    const list: { id: string; label: string; stream: MediaStream; local?: boolean; peer?: PeerView }[] = []
    if (state.screen) list.push({ id: 'me', label: `${session.name} (você)`, stream: state.screen, local: true })
    for (const p of state.peers) if (p.screen) list.push({ id: p.id, label: p.name, stream: p.screen, peer: p })
    return list
  }, [state.screen, state.peers, session.name])

  const focusedTile = tiles.find((t) => t.id === focus)
  const visibleTiles = focusedTile ? [focusedTile] : tiles
  const vol = (id: string) => volumes[id] ?? 1

  if (state.status === 'conectando' || state.status === 'aguardando-aprovacao' || state.status === 'erro') {
    return (
      <main className="center">
        <div className="card narrow">
          <h2>
            {state.status === 'conectando' && 'Conectando à sala...'}
            {state.status === 'aguardando-aprovacao' && 'Esperando o host aprovar sua entrada...'}
            {state.status === 'erro' && 'Não deu para entrar'}
          </h2>
          {state.error && <p className="error">{state.error}</p>}
          <div className="modal-actions">
            {state.status === 'erro' && <button onClick={reconnect}>Tentar de novo</button>}
            <button onClick={onLeave}>Voltar</button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <div className="room">
      <aside className="sidebar">
        <h1 className="brand">JanJa</h1>

        {session.hosted && (
          <section className="share-codes">
            <h3>Convide os amigos</h3>
            {session.hosted.codes.length === 0 && <p className="muted small">Nenhum IP de rede encontrado.</p>}
            {session.hosted.codes.map((c) => (
              <div key={c.code} className="code-row">
                <small>{c.label}</small>
                <button onClick={() => void copy(c.code)}>{copied === c.code ? 'Copiado!' : 'Copiar link'}</button>
              </div>
            ))}
          </section>
        )}

        <section>
          <h3>Na sala ({state.peers.length + 1})</h3>
          <ul className="people">
            <li>
              <span className={`dot ${state.me.micMuted || !state.micAvailable ? 'off' : 'on'}`} />
              <strong>{session.name}</strong> <small className="muted">você</small>
            </li>
            {state.peers.map((p) => (
              <li key={p.id}>
                <span className={`dot ${p.state.micMuted ? 'off' : 'on'}`} />
                <div className="person">
                  <strong>{p.name}</strong>
                  <small className={`route ${p.route}`}>{routeInfo(p)}</small>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={vol(`mic:${p.id}`)}
                    onChange={(e) => setVolumes((v) => ({ ...v, [`mic:${p.id}`]: Number(e.target.value) }))}
                    title="Volume da voz"
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
        {tiles.length === 0 ? (
          <div className="empty">
            <p>Ninguém está compartilhando a tela ainda.</p>
            <button className="primary" onClick={() => setPicking(true)}>
              Compartilhar minha tela
            </button>
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
            <>
              <button className="danger" onClick={stopShare}>
                Parar de compartilhar
              </button>
              <select
                value={state.preset.id}
                onChange={(e) => setPreset(PRESETS.find((p) => p.id === e.target.value)!)}
                title="Qualidade"
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <button className="primary" onClick={() => setPicking(true)}>
              Compartilhar tela
            </button>
          )}

          <select value={sinkId} onChange={(e) => setSinkId(e.target.value)} title="Saída de áudio da sala">
            {outputs.length === 0 && <option value="default">Saída padrão</option>}
            {outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Saída de áudio'}
              </option>
            ))}
          </select>

          <span className="spacer" />
          <button className="danger" onClick={onLeave}>
            {session.hosted ? 'Encerrar sala' : 'Sair'}
          </button>
        </footer>
      </main>

      {picking && (
        <SourcePicker
          viewers={state.peers.length}
          initialPreset={state.preset}
          onCancel={() => setPicking(false)}
          onConfirm={async (id, audio, preset) => {
            await startShare(id, audio, preset)
            setPicking(false)
          }}
        />
      )}

      {requests[0] && (
        <div className="modal-backdrop">
          <div className="modal narrow">
            <h2>{requests[0].name} quer entrar na sala</h2>
            <p className="muted">Só aceite se você reconhece quem é.</p>
            <div className="modal-actions">
              <button className="danger" onClick={() => answer(requests[0], false)}>
                Recusar
              </button>
              <button className="primary" onClick={() => answer(requests[0], true)}>
                Deixar entrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
