import '@fontsource-variable/pixelify-sans'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MAX_ANSWER, startsWith } from '../../../../shared/games/stop/categories'
import type { Answers, StopView } from '../../../../shared/games/stop/types'
import type { StopSceneProps } from '../../contract'

/** quanto esperar sem digitar antes de mandar as respostas para o servidor */
const SAVE_MS = 600

/** Respostas da rodada: começa do que o servidor guardou e manda sozinho enquanto a pessoa escreve. */
function useDraft(view: StopView, onAct: StopSceneProps['onAct']) {
  const [draft, setDraft] = useState<Answers>(() => ({ ...view.myAnswers }))
  const round = useRef(view.round)
  const sent = useRef(JSON.stringify(view.myAnswers))
  const latest = useRef(draft)
  latest.current = draft

  // rodada nova: começa em branco
  useEffect(() => {
    if (view.round !== round.current) {
      round.current = view.round
      setDraft({ ...view.myAnswers })
      sent.current = JSON.stringify(view.myAnswers)
    }
  }, [view.round, view.myAnswers])

  const flush = () => {
    const json = JSON.stringify(latest.current)
    if (json === sent.current) return
    sent.current = json
    onAct({ type: 'write', round: round.current, answers: latest.current })
  }
  const writing = view.phase === 'escrevendo' || view.phase === 'parando'
  useEffect(() => {
    if (!writing) return
    const t = window.setTimeout(flush, SAVE_MS)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, writing])
  // gritaram STOP: manda já o que está escrito
  useEffect(() => {
    if (view.phase === 'parando') flush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.phase])
  return { draft, setDraft, flush }
}

function Writing({ view, onAct }: StopSceneProps) {
  const { draft, setDraft } = useDraft(view, onAct)
  const playing = !!view.you
  const ok = (id: string) => (draft[id] ?? '').trim() !== '' && startsWith(draft[id] ?? '', view.letter)
  const all = view.categories.every((c) => ok(c.id))
  const stop = () => {
    if (all && view.phase === 'escrevendo') onAct({ type: 'stop', round: view.round, answers: draft })
  }
  const stopper = view.players.find((p) => p.playerId === view.stoppedBy)
  const onKey = (e: KeyboardEvent<HTMLInputElement>, last: boolean) => {
    if (e.key === 'Enter' && last) {
      e.preventDefault()
      stop()
    }
  }

  return (
    <div className="sp-writing">
      {view.phase === 'parando' && (
        <div className="sp-banner pixel-font" role="status">
          {stopper ? `${stopper.name} gritou STOP!` : 'Acabou o tempo!'} Terminando...
        </div>
      )}
      {playing ? (
        <form
          className="sp-form"
          onSubmit={(e) => {
            e.preventDefault()
            stop()
          }}
        >
          {view.categories.map((c, i) => {
            const v = draft[c.id] ?? ''
            const state = !v.trim() ? '' : ok(c.id) ? 'ok' : 'bad'
            return (
              <label key={c.id} className={`sp-field ${state}`}>
                <span>{c.name}</span>
                <input
                  value={v}
                  maxLength={MAX_ANSWER}
                  placeholder={`${view.letter}... (${c.hint})`}
                  autoFocus={i === 0}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                  onKeyDown={(e) => onKey(e, i === view.categories.length - 1)}
                  aria-invalid={state === 'bad'}
                />
                {state === 'bad' && <small>Tem que começar com {view.letter}.</small>}
              </label>
            )
          })}
          <button className="primary sp-stop pixel-font" type="submit" disabled={!all || view.phase !== 'escrevendo'}>
            STOP!
          </button>
          {!all && view.phase === 'escrevendo' && <small className="muted">Preencha tudo com {view.letter} para poder gritar STOP.</small>}
        </form>
      ) : (
        <p className="muted">Você está assistindo. As respostas aparecem quando alguém gritar STOP.</p>
      )}
    </div>
  )
}

function Review({ view, onAct }: StopSceneProps) {
  const me = view.you?.playerId ?? null
  const review = view.review ?? {}
  const scored = view.phase !== 'conferindo'
  const meReady = view.players.find((p) => p.playerId === me)?.ready
  const roundPoints = scored ? view.history[view.history.length - 1]?.points ?? {} : null
  return (
    <div className="sp-review">
      <div className="sp-table-wrap">
        <table className="sp-table">
          <thead>
            <tr>
              <th scope="col">Categoria</th>
              {view.players.map((p) => (
                <th key={p.playerId} scope="col" className={p.playerId === me ? 'me' : ''}>
                  {p.playerId === me ? 'Você' : p.name}
                  {!scored && p.ready && <small> · pronto</small>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.categories.map((c) => (
              <tr key={c.id}>
                <th scope="row">{c.name}</th>
                {(review[c.id] ?? []).map((e) => {
                  const cls = !e.fits ? 'nofit' : e.invalid ? 'invalid' : e.points === 10 ? 'unique' : e.points === 5 ? 'shared' : ''
                  const canVote = !scored && me && e.playerId !== me && e.fits
                  return (
                    <td key={e.playerId} className={cls}>
                      <span className="sp-answer">{e.answer || '—'}</span>
                      {e.points !== null && <b className="sp-pts">{e.points}</b>}
                      {e.votes > 0 && !scored && <small className="sp-votes">{e.votes} não vale</small>}
                      {canVote && (
                        <button
                          className={`sp-vote ${e.mine ? 'on' : ''}`}
                          onClick={() => onAct({ type: 'vote', round: view.round, target: e.playerId, category: c.id, invalid: !e.mine })}
                          aria-pressed={e.mine}
                          aria-label={`${e.mine ? 'Tirar o não vale de' : 'Não vale:'} ${e.answer}`}
                        >
                          não vale
                        </button>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          {roundPoints && (
            <tfoot>
              <tr>
                <th scope="row">Rodada</th>
                {view.players.map((p) => (
                  <td key={p.playerId}>
                    <b>{roundPoints[p.playerId] ?? 0}</b>
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Total</th>
                {view.players.map((p) => (
                  <td key={p.playerId}>
                    <b className="sp-total">{p.total}</b>
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!scored && me && (
        <div className="sp-actions">
          <small className="muted">Marque "não vale" nas respostas que não servem. Cai com a maioria dos outros.</small>
          <button className="primary" disabled={meReady} onClick={() => onAct({ type: 'ready', round: view.round })}>
            {meReady ? 'Esperando os outros' : 'Pronto'}
          </button>
        </div>
      )}
    </div>
  )
}

/** Stop: a letra, os campos de cada categoria e, depois do STOP, a conferência com os pontos. */
export function StopScene(props: StopSceneProps) {
  const { view } = props
  const n = view.categories.length
  return (
    <div className="sp-scene">
      <aside className="sp-side">
        <div className="sp-letter pixel-font" aria-label={`Letra ${view.letter}`}>
          {view.letter}
        </div>
        <small className="muted">
          Rodada {view.round} de {view.rounds}
        </small>
        <ul className="sp-players">
          {view.players.map((p) => (
            <li key={p.playerId} className={p.playerId === view.you?.playerId ? 'me' : ''}>
              <span className="sp-pname">{p.name}</span>
              {view.phase === 'escrevendo' || view.phase === 'parando' ? (
                <span className="sp-progress" aria-label={`${p.filled} de ${n} preenchidas`}>
                  {Array.from({ length: n }, (_, i) => (
                    <i key={i} className={i < p.filled ? 'on' : ''} />
                  ))}
                </span>
              ) : (
                <b>{p.total}</b>
              )}
            </li>
          ))}
        </ul>
      </aside>
      <section className="sp-main">{view.phase === 'escrevendo' || view.phase === 'parando' ? <Writing {...props} /> : <Review {...props} />}</section>
    </div>
  )
}
