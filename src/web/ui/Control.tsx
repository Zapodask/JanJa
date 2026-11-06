import { useEffect, useId, useState } from 'react'
import { HELPER_DOWNLOAD_URL, HELPER_EXE_URL, PANIC_SHORTCUT } from '../../shared/control'
import { pickMonitor } from '../control/geometry'
import type { HelperSnapshot, HelperStatus } from '../control/helperClient'
import { isWholeScreen } from '../control/useControl'
import { Avatar } from './Avatar'
import { Icon } from './icons'

interface HelperActions {
  helper: HelperSnapshot
  onConnect: () => void
  onDisconnect: () => void
  onPair: (code: string) => boolean
}

const STATUS_TEXT: Record<HelperStatus, string> = {
  desligado: 'Desligado. Conecte para deixar amigos pedirem o controle do seu PC.',
  procurando: 'Procurando o JanJa Helper neste PC…',
  'precisa-parear': 'Digite o código de 6 dígitos que aparece na janela do helper.',
  pronto: 'Conectado. Amigos podem pedir o controle do seu PC.',
  erro: 'Não deu para falar com o helper.'
}

const STATUS_DOT: Record<HelperStatus, string> = {
  desligado: 'idle',
  procurando: 'wait',
  'precisa-parear': 'wait',
  pronto: 'ok',
  erro: 'bad'
}

export function HelperDownloadLink() {
  return (
    <a href={HELPER_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
      Baixar o JanJa Helper
    </a>
  )
}

const isWindows = (): boolean => {
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  return /win/i.test(uaData?.platform ?? navigator.platform ?? '') || /Windows/.test(navigator.userAgent)
}

/** Procurando há um tempo sem achar: o helper provavelmente não está instalado ou aberto. */
const NOT_FOUND_AFTER_MS = 3500

function useNotFound(status: HelperStatus): boolean {
  const [notFound, setNotFound] = useState(false)
  useEffect(() => {
    if (status !== 'procurando' && status !== 'erro') {
      setNotFound(false)
      return
    }
    const t = window.setTimeout(() => setNotFound(true), NOT_FOUND_AFTER_MS)
    return () => window.clearTimeout(t)
  }, [status])
  return notFound
}

/** Passo a passo para quem ainda não tem o helper. A página segue procurando e conecta sozinha. */
function InstallHelper() {
  if (!isWindows()) {
    return (
      <div className="install-helper">
        <p>
          <strong>O JanJa Helper ainda é só para Windows.</strong> Daqui você pode assistir e controlar o PC de um amigo,
          mas não ser controlado.
        </p>
      </div>
    )
  }
  return (
    <div className="install-helper">
      <p>
        <strong>O JanJa Helper não está aberto neste PC.</strong> Ele é o programinha que deixa um amigo mexer no seu
        mouse e teclado, só quando você permitir.
      </p>
      <a className="button primary wide" href={HELPER_EXE_URL} download>
        <Icon name="download" size={18} /> Baixar para Windows
      </a>
      <ol>
        <li>Abra o arquivo baixado (janja-helper.exe). Não precisa instalar.</li>
        <li>
          Se aparecer &quot;O Windows protegeu o computador&quot;, clique em <em>Mais informações</em> e depois em{' '}
          <em>Executar assim mesmo</em>.
        </li>
        <li>Volte aqui: esta página encontra o helper sozinha.</li>
      </ol>
    </div>
  )
}

function PairForm({ onPair, error }: { onPair: (code: string) => boolean; error?: string }) {
  const [code, setCode] = useState('')
  const id = useId()
  return (
    <form
      className="pair-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (onPair(code)) setCode('')
      }}
    >
      <label htmlFor={id} className="visually-hidden">
        Código de pareamento
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
      <button type="submit" className="primary" disabled={code.length !== 6}>
        Parear
      </button>
      {error && <p className="error pair-error">{error}</p>}
    </form>
  )
}

/** Estado do helper com o que a pessoa precisa fazer agora. Usado na barra lateral e no pedido. */
export function HelperStatusBlock({ helper, onConnect, onDisconnect, onPair }: HelperActions) {
  const { status } = helper
  const notFound = useNotFound(status)
  return (
    <div className="helper-block">
      <p className="helper-status">
        <i className={`dot ${STATUS_DOT[status]}`} />
        <span>{status === 'erro' && helper.error ? helper.error : STATUS_TEXT[status]}</span>
      </p>
      {status === 'precisa-parear' && <PairForm onPair={onPair} error={helper.pairError} />}
      {status === 'pronto' && helper.error && <p className="error">{helper.error}</p>}
      {notFound && <InstallHelper />}
      <div className="helper-actions">
        {status === 'desligado' ? (
          <button className="wide" onClick={onConnect}>
            Conectar ao helper
          </button>
        ) : (
          <button className="wide" onClick={onDisconnect}>
            {notFound ? 'Parar de procurar' : 'Desconectar'}
          </button>
        )}
      </div>
      {status === 'desligado' && (
        <p className="helper-hint">
          Ainda não tem?{' '}
          <a href={HELPER_EXE_URL} download>
            Baixar o helper
          </a>
        </p>
      )}
    </div>
  )
}

/** Seção "Controle remoto" da barra lateral. */
export function ControlSection(props: HelperActions) {
  return (
    <section>
      <h3>Controle remoto</h3>
      <HelperStatusBlock {...props} />
    </section>
  )
}

const monitorLabel = (m: { id: number; w: number; h: number; primary: boolean }, i: number): string =>
  `Monitor ${i + 1}${m.primary ? ' (principal)' : ''}, ${m.w}x${m.h}`

/** Modal de pedido: o controlado decide. Sem clique em Permitir nada é repassado. */
export function ControlRequestModal({
  name,
  screen,
  onAllow,
  onRefuse,
  ...helperActions
}: HelperActions & {
  name: string
  screen?: MediaStream
  onAllow: (monitor?: number) => void
  onRefuse: () => void
}) {
  const { helper } = helperActions
  const settings = screen?.getVideoTracks()[0]?.getSettings()
  const pick = pickMonitor(helper.monitors, settings?.width, settings?.height)
  const [chosen, setChosen] = useState<number | undefined>()
  const monitor = chosen !== undefined && helper.monitors.some((m) => m.id === chosen) ? chosen : pick.monitor
  const wholeScreen = isWholeScreen(screen)
  const ready = helper.status === 'pronto'
  const selectId = useId()

  return (
    <div className="modal-backdrop">
      <div className="modal control-modal" role="dialog" aria-modal="true" aria-labelledby="control-title">
        <Avatar name={name} size={56} />
        <h2 id="control-title">{name} quer controlar sua tela</h2>
        <p className="muted">
          Mouse e teclado dela vão agir no seu PC enquanto você deixar. Você pode parar a qualquer momento, e o atalho{' '}
          <strong>{PANIC_SHORTCUT}</strong> corta na hora.
        </p>

        {!wholeScreen && (
          <p className="error">Só dá para permitir compartilhando a tela inteira. Compartilhe o monitor todo e peça de novo.</p>
        )}

        {wholeScreen && !ready && (
          <div className="control-help">
            <p>Para permitir, o JanJa Helper precisa estar rodando neste PC e conectado aqui.</p>
            <HelperStatusBlock {...helperActions} />
          </div>
        )}

        {wholeScreen && ready && pick.needsChoice && (
          <label className="field" htmlFor={selectId}>
            <span>Qual monitor você está compartilhando?</span>
            <select id={selectId} value={monitor} onChange={(e) => setChosen(Number(e.target.value))}>
              {helper.monitors.map((m, i) => (
                <option key={m.id} value={m.id}>
                  {monitorLabel(m, i)}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="modal-actions">
          <button className="danger" onClick={onRefuse}>
            Recusar
          </button>
          <button className="primary" disabled={!wholeScreen || !ready} onClick={() => onAllow(monitor)}>
            Permitir
          </button>
        </div>
      </div>
    </div>
  )
}

/** Faixa fixa no topo durante toda a sessão: quem é controlado nunca fica sem saber. */
export function ControlBanner({ name, onStop }: { name: string; onStop: () => void }) {
  return (
    <div className="control-banner" role="alert">
      <Icon name="mouse" size={18} />
      <span className="control-banner-text">
        <strong>{name}</strong> está controlando seu PC
      </span>
      <span className="control-banner-hint">Pânico: {PANIC_SHORTCUT}</span>
      <button className="danger" onClick={onStop}>
        Parar
      </button>
    </div>
  )
}
