import { useEffect, useState } from 'react'
import type { CaptureSource } from '../../../preload/api'
import { PRESETS, uploadEstimateMbps, type QualityPreset } from '../rtc/quality'

interface Props {
  viewers: number
  initialPreset: QualityPreset
  onCancel: () => void
  onConfirm: (sourceId: string, withAudio: boolean, preset: QualityPreset) => Promise<void>
}

export function SourcePicker({ viewers, initialPreset, onCancel, onConfirm }: Props) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
  const [selected, setSelected] = useState<string>()
  const [preset, setPreset] = useState(initialPreset)
  const audioSupported = window.janja.platform === 'win32'
  const [withAudio, setWithAudio] = useState(audioSupported)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.janja
      .listSources()
      .then((list) => {
        setSources(list)
        setSelected(list.find((s) => s.kind === 'screen')?.id ?? list[0]?.id)
      })
      .catch((err: unknown) => setError(String(err)))
  }, [])

  const confirm = async () => {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      await onConfirm(selected, withAudio && audioSupported, preset)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const group = (kind: CaptureSource['kind'], title: string) => {
    const items = sources?.filter((s) => s.kind === kind) ?? []
    if (items.length === 0) return null
    return (
      <>
        <h3>{title}</h3>
        <div className="source-grid">
          {items.map((s) => (
            <button
              key={s.id}
              className={`source ${selected === s.id ? 'selected' : ''}`}
              onClick={() => setSelected(s.id)}
              onDoubleClick={() => void confirm()}
              title={s.name}
            >
              <img src={s.thumbnail} alt="" />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      </>
    )
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal picker" onClick={(e) => e.stopPropagation()}>
        <h2>O que você quer compartilhar?</h2>
        {!sources && !error && <p className="muted">Carregando telas e janelas...</p>}
        <div className="picker-list">
          {group('screen', 'Telas')}
          {group('window', 'Janelas')}
        </div>

        <div className="picker-options">
          <label className="field">
            <span>Qualidade</span>
            <select value={preset.id} onChange={(e) => setPreset(PRESETS.find((p) => p.id === e.target.value)!)}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            Upload estimado: ~{uploadEstimateMbps(preset, viewers).toFixed(1)} Mbps para {viewers}{' '}
            {viewers === 1 ? 'espectador' : 'espectadores'}.
          </p>
          <label className={`check ${audioSupported ? '' : 'disabled'}`}>
            <input
              type="checkbox"
              disabled={!audioSupported}
              checked={withAudio && audioSupported}
              onChange={(e) => setWithAudio(e.target.checked)}
            />
            Incluir áudio do sistema
            {!audioSupported && <small> (só no Windows por enquanto)</small>}
          </label>
          {withAudio && audioSupported && (
            <p className="muted small">
              O áudio do sistema inclui o som da sala. Para os amigos não ouvirem o próprio eco, escolha outra saída
              de áudio para a sala (ex.: fone) no menu de saída.
            </p>
          )}
        </div>

        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button onClick={onCancel}>Cancelar</button>
          <button className="primary" disabled={!selected || busy} onClick={() => void confirm()}>
            {busy ? 'Iniciando...' : 'Compartilhar'}
          </button>
        </div>
      </div>
    </div>
  )
}
