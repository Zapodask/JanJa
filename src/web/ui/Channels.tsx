import { useState, type FormEvent } from 'react'
import {
  HEAVY_CHANNEL,
  MAX_CHANNEL_NAME,
  CHANNEL_LIMITS,
  MAX_CHANNELS,
  MAX_ROOM_NAME,
  UNLIMITED,
  channelHasRoom,
  type PeerInfo,
  type RoomSettings
} from '../../shared/protocol'
import { useAudioLevel, useSpeaking } from '../audio'
import { useInstall } from '../install'
import type { PeerView } from '../rtc/PeerManager'
import type { RecentRoom } from '../storage'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { VolumeSlider } from './media'
import { roomTitle, timeAgo } from './recent'
import { noAutofill } from './noAutofill'

/**
 * Linha compacta de uma pessoa do seu canal (estilo Raidcall): avatar pequeno, nome e mic.
 * Quem fala ganha aura. Clicar no nome mostra o volume e a conexão.
 */
export function PersonRow({
  name,
  stream,
  muted,
  isHost,
  you,
  detail,
  volume,
  onVolume
}: {
  name: string
  stream?: MediaStream
  muted: boolean
  isHost?: boolean
  you?: boolean
  detail?: string
  volume?: number
  onVolume?: (v: number) => void
}) {
  const [open, setOpen] = useState(false)
  const active = !muted && !!stream
  const speaking = useSpeaking(stream, active)
  const level = useAudioLevel(stream, active)
  const canOpen = !!onVolume || !!detail
  const label = (
    <>
      <Avatar name={name} size={22} level={level} speaking={speaking} />
      <span className="person-name">
        {name}
        {you && <em> (você)</em>}
      </span>
      {isHost && (
        <span className="host-mark" data-tip="Criou a sala" data-tip-pos="left">
          <Icon name="crown" size={13} />
        </span>
      )}
    </>
  )
  return (
    <li className={`person ${speaking ? 'speaking' : ''} ${you ? 'you' : ''}`}>
      <div className="person-line">
        {canOpen ? (
          <button className="person-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${name}: volume e conexão`}>
            {label}
          </button>
        ) : (
          <div className="person-btn">{label}</div>
        )}
        <MicState muted={muted} />
      </div>
      {open && canOpen && (
        <div className="person-more">
          {detail && <small className="detail">{detail}</small>}
          {onVolume && volume !== undefined && <VolumeSlider value={volume} onChange={onVolume} label={`Volume da voz de ${name}`} />}
        </div>
      )}
    </li>
  )
}

function MicState({ muted }: { muted: boolean }) {
  return (
    <span className={`mic-state ${muted ? 'off' : 'on'}`} data-tip={muted ? 'Mic desligado' : 'Mic ligado'} data-tip-pos="left">
      <Icon name={muted ? 'micOff' : 'mic'} size={14} />
    </span>
  )
}

/** Pessoa de outro canal: só o nome (a voz dela não chega até você). */
function FarRow({ peer }: { peer: PeerInfo }) {
  return (
    <li className="person far">
      <div className="person-line">
        <div className="person-btn">
          <Avatar name={peer.name} size={22} />
          <span className="person-name">{peer.name}</span>
          {peer.isHost && (
            <span className="host-mark" data-tip="Criou a sala" data-tip-pos="left">
              <Icon name="crown" size={13} />
            </span>
          )}
        </div>
        <MicState muted={peer.state.micMuted} />
      </div>
    </li>
  )
}

const limitText = (n: number): string => (n === UNLIMITED ? 'Sem limite' : `Até ${n} pessoas`)

/** Criar ou editar canal: nome e limite de pessoas. Enter salva, Esc cancela. */
function ChannelForm({
  initialName = '',
  initialLimit = HEAVY_CHANNEL,
  saveLabel,
  onSave,
  onCancel
}: {
  initialName?: string
  initialLimit?: number
  saveLabel: string
  onSave: (name: string, limit: number) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [limit, setLimit] = useState(initialLimit)
  const options: number[] = CHANNEL_LIMITS.includes(limit as (typeof CHANNEL_LIMITS)[number]) ? [...CHANNEL_LIMITS] : [limit, ...CHANNEL_LIMITS]
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const clean = name.trim()
    if (clean) onSave(clean, limit)
    else onCancel()
  }
  return (
    <form className="channel-form" autoComplete="off" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <input
        {...noAutofill('canal')}
        autoFocus
        value={name}
        maxLength={MAX_CHANNEL_NAME}
        placeholder="Nome do canal"
        aria-label="Nome do canal"
        onChange={(e) => setName(e.target.value)}
      />
      <div className="channel-form-row">
        <select className="limit-select" value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Limite de pessoas no canal">
          {options.map((n) => (
            <option key={n} value={n}>
              {limitText(n)}
            </option>
          ))}
        </select>
        <button type="submit" className="primary sm-btn" disabled={!name.trim()}>
          {saveLabel}
        </button>
        <button type="button" className="icon-btn sm" aria-label="Cancelar" onClick={onCancel}>
          <Icon name="x" size={16} />
        </button>
      </div>
    </form>
  )
}

interface Props {
  settings: RoomSettings
  channelId?: string
  isHost: boolean
  /** você, no topo do seu canal */
  self: { name: string; stream?: MediaStream; muted: boolean }
  /** conexões de mídia (só o seu canal) */
  peers: PeerView[]
  /** todo mundo da sala, de todos os canais */
  roster: PeerInfo[]
  detailFor: (p: PeerView) => string | undefined
  volumeFor: (name: string) => number
  onVolume: (name: string, v: number) => void
  onJoin: (channelId: string) => void
  onCreate: (name: string, limit: number) => void
  onEdit: (channelId: string, name: string, limit: number) => void
  onDelete: (channelId: string) => void
}

/** Canais da sala, estilo Raidcall: clique num canal para entrar; a voz só liga quem está junto. */
export function ChannelList(props: Props) {
  const { settings, channelId, isHost, self, peers, roster } = props
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const total = roster.length + 1
  const { channels } = settings
  const hereCount = roster.filter((p) => p.channelId === channelId).length + 1

  const remove = (id: string, name: string) => {
    const rest = channels.filter((ch) => ch.id !== id)
    if (window.confirm(`Apagar o canal "${name}"? Quem estiver nele vai para "${rest[0]?.name ?? ''}".`)) props.onDelete(id)
  }

  return (
    <section data-tour="people" className="channels">
      <div className="section-head">
        <h3>Na sala ({total})</h3>
      </div>

      <ul className="channel-list">
        {channels.map((ch) => {
          const here = ch.id === channelId
          const members = roster.filter((p) => p.channelId === ch.id)
          const count = members.length + (here ? 1 : 0)
          const full = !here && !channelHasRoom(ch, count)
          return (
            <li key={ch.id} className={`channel ${here ? 'here' : ''} ${full ? 'full' : ''}`}>
              {editing === ch.id ? (
                <ChannelForm
                  initialName={ch.name}
                  initialLimit={ch.limit ?? UNLIMITED}
                  saveLabel="Salvar"
                  onSave={(name, limit) => {
                    if (name !== ch.name || limit !== (ch.limit ?? UNLIMITED)) props.onEdit(ch.id, name, limit)
                    setEditing(null)
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="channel-head">
                  <button
                    className="channel-name"
                    onClick={() => !here && !full && props.onJoin(ch.id)}
                    aria-current={here ? 'true' : undefined}
                    aria-disabled={full ? 'true' : undefined}
                    data-tip={full ? 'Canal cheio' : undefined}
                    aria-label={here ? `${ch.name}, você está aqui` : full ? `${ch.name}, cheio` : `Entrar no canal ${ch.name}`}
                  >
                    <Icon name="speaker" size={14} />
                    <span className="channel-label">{ch.name}</span>
                    <span className="channel-count">{ch.limit ? `${count}/${ch.limit}` : count}</span>
                  </button>
                  {isHost && (
                    <span className="channel-actions">
                      <button className="icon-btn sm" onClick={() => setEditing(ch.id)} aria-label={`Editar ${ch.name}`} data-tip="Nome e limite">
                        <Icon name="pencil" size={14} />
                      </button>
                      {channels.length > 1 && (
                        <button className="icon-btn sm" onClick={() => remove(ch.id, ch.name)} aria-label={`Apagar ${ch.name}`} data-tip="Apagar">
                          <Icon name="x" size={14} />
                        </button>
                      )}
                    </span>
                  )}
                </div>
              )}
              {count > 0 && (
                <ul className="people">
                  {here ? (
                    <>
                      <PersonRow name={self.name} you isHost={isHost} stream={self.stream} muted={self.muted} />
                      {peers.map((p) => (
                        <PersonRow
                          key={p.id}
                          name={p.name}
                          isHost={p.isHost}
                          stream={p.mic}
                          muted={p.state.micMuted}
                          detail={props.detailFor(p)}
                          volume={props.volumeFor(p.name)}
                          onVolume={(v) => props.onVolume(p.name, v)}
                        />
                      ))}
                    </>
                  ) : (
                    members.map((p) => <FarRow key={p.peerId} peer={p} />)
                  )}
                </ul>
              )}
            </li>
          )
        })}
      </ul>

      {/* só quem criou a sala mexe nos canais */}
      {isHost &&
        (adding ? (
          <ChannelForm
            saveLabel="Criar"
            onSave={(name, limit) => {
              props.onCreate(name, limit)
              setAdding(false)
            }}
            onCancel={() => setAdding(false)}
          />
        ) : channels.length < MAX_CHANNELS ? (
          <button className="new-channel" onClick={() => setAdding(true)} aria-label="Novo canal">
            <Icon name="plus" size={14} /> Novo canal
          </button>
        ) : (
          <p className="small muted">Limite de {MAX_CHANNELS} canais.</p>
        ))}

      {hereCount > HEAVY_CHANNEL && (
        <p className="channel-warn small">
          <Icon name="warn" size={14} /> Com mais de {HEAVY_CHANNEL} pessoas no mesmo canal a voz pode travar. Dividam em outro canal.
        </p>
      )}
    </section>
  )
}

/** Rodapé da barra lateral: instalar o JanJa como app (o helper fica no bloco do controle remoto, logo acima). */
export function DownloadBox() {
  const { canInstall, installed, install } = useInstall()
  return (
    <section className="download-box">
      <h3>Baixar</h3>
      {installed ? (
        <p className="small muted">Você está usando o app do JanJa.</p>
      ) : canInstall ? (
        <button className="wide" onClick={() => void install()}>
          <Icon name="download" size={16} /> Instalar o JanJa
        </button>
      ) : (
        <p className="small muted">Para instalar o JanJa como app, abra o menu do Chrome ou do Edge e escolha "Instalar".</p>
      )}
    </section>
  )
}

/** Topo da barra lateral, estilo Raidcall: o nome da sala ("servidor") e o link. O dono troca o nome pelo lápis. */
export function ServerCard({
  name,
  isHost,
  onRename,
  onCopy
}: {
  name: string
  isHost: boolean
  onRename: (name: string) => void
  onCopy: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const clean = draft.trim()
    if (clean && clean !== name) onRename(clean)
    setEditing(false)
  }
  return (
    <section className="server-card">
      {editing ? (
        <form className="server-form" autoComplete="off" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}>
          <input
            {...noAutofill('sala')}
            autoFocus
            value={draft}
            maxLength={MAX_ROOM_NAME}
            aria-label="Nome da sala"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="icon-btn sm" aria-label="Salvar nome" disabled={!draft.trim()}>
            <Icon name="check" size={16} />
          </button>
          <button type="button" className="icon-btn sm" aria-label="Cancelar" onClick={() => setEditing(false)}>
            <Icon name="x" size={16} />
          </button>
        </form>
      ) : (
        <div className="server-head">
          <strong className="server-name" title={name}>
            {name || 'Sala'}
          </strong>
          {isHost && (
            <button
              className="icon-btn sm"
              onClick={() => {
                setDraft(name)
                setEditing(true)
              }}
              aria-label="Trocar o nome da sala"
              data-tip="Trocar o nome"
              data-tip-pos="left"
            >
              <Icon name="pencil" size={14} />
            </button>
          )}
        </div>
      )}
      <button className="wide" data-tour="copy-link" onClick={onCopy}>
        <Icon name="link" size={16} /> Copiar link da sala
      </button>
    </section>
  )
}

/** Outras salas ("servidores") que você visitou neste navegador, pelo nome. */
export function OtherRooms({ rooms, onOpen }: { rooms: RecentRoom[]; onOpen: (roomId: string) => void }) {
  if (rooms.length === 0) return null
  return (
    <section className="other-rooms">
      <h3>Outros servidores</h3>
      <ul>
        {rooms.map((r) => (
          <li key={r.roomId}>
            <button className="other-room" onClick={() => onOpen(r.roomId)}>
              <strong>{roomTitle(r)}</strong>
              <small>{timeAgo(r.at)}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
