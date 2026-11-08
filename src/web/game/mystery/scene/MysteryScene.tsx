import '@fontsource-variable/pixelify-sans'
import { useEffect, useMemo, useState } from 'react'
import { cardById, PLACES, SUSPECTS, TOOLS, type Kind, type MysteryCard } from '../../../../shared/games/mystery/cards'
import type { MysteryView, SuggestionView, Triple } from '../../../../shared/games/mystery/types'
import { Icon } from '../../../ui/icons'
import type { MysterySceneProps } from '../../contract'
import { autoMarks, inEnvelope, merge, nextMark, ruledOut, type Mark, type Marks } from './notes'
import { ICONS, portrait, runs } from './pixel'

const KIND_LABEL: Record<Kind, string> = { quem: 'Quem', onde: 'Onde', como: 'Com o quê' }
const KIND_COLOR: Record<Kind, string> = { quem: '#E07A9A', onde: '#6FA3C7', como: '#FFC94A' }
const GROUPS: Array<[Kind, readonly MysteryCard[]]> = [
  ['quem', SUSPECTS],
  ['onde', PLACES],
  ['como', TOOLS]
]

function Art({ card, size }: { card: MysteryCard; size: number }) {
  const sprite = card.kind === 'quem' ? portrait(card.id) : ICONS[card.id]
  const n = sprite.length
  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" aria-hidden="true" className="my-art">
      {runs(sprite, card.color).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  )
}

/** carta do Mistério: faixa do tipo, desenho e nome */
export function MysteryCardTile({ id, small, dim, on, onClick }: { id: string; small?: boolean; dim?: boolean; on?: boolean; onClick?: () => void }) {
  const c = cardById(id)
  if (!c) return null
  const body = (
    <>
      <span className="my-band" style={{ background: KIND_COLOR[c.kind] }}>
        {KIND_LABEL[c.kind]}
      </span>
      <Art card={c} size={small ? 36 : 56} />
      <span className="my-cname">{c.name}</span>
    </>
  )
  const cls = `my-card ${small ? 'small' : ''} ${dim ? 'dim' : ''} ${on ? 'on' : ''}`
  return onClick ? (
    <button className={cls} onClick={onClick} aria-pressed={on} aria-label={c.name}>
      {body}
    </button>
  ) : (
    <div className={cls} aria-label={c.name}>
      {body}
    </div>
  )
}

const storageKey = (v: MysteryView) => `janja.misterio.${v.players.map((p) => p.playerId).join('-')}.${[...v.myCards].sort().join('-')}`

/** marcas que a pessoa fez à mão (guardadas neste navegador, por partida) */
function useManualMarks(v: MysteryView): [Marks, (card: string, p: number) => void] {
  const key = storageKey(v)
  const [marks, setMarks] = useState<Marks>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}') as Marks
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(marks))
    } catch {
      // sem armazenamento: o caderno vale só nesta aba
    }
  }, [key, marks])
  const cycle = (card: string, p: number) =>
    setMarks((m) => ({ ...m, [card]: { ...(m[card] ?? {}), [p]: nextMark((m[card]?.[p] ?? '') as Mark) } }))
  return [marks, cycle]
}

function MarkGlyph({ m }: { m: Mark | undefined }) {
  if (m === 'tem') return <Icon name="check" size={14} />
  if (m === 'nao') return <Icon name="x" size={14} />
  if (m === 'talvez') return <span>?</span>
  return null
}

function Notebook({ view, marks, auto, onCycle }: { view: MysteryView; marks: Marks; auto: Marks; onCycle: (card: string, p: number) => void }) {
  const n = view.players.length
  return (
    <table className="my-notes">
      <thead>
        <tr>
          <th scope="col">Caderno</th>
          {view.players.map((p) => (
            <th key={p.playerId} scope="col" data-tip={p.name} aria-label={p.name}>
              {p.index === view.you?.index ? 'Você' : p.name.slice(0, 4)}
            </th>
          ))}
        </tr>
      </thead>
      {GROUPS.map(([kind, cards]) => (
        <tbody key={kind}>
          <tr className="my-notes-head">
            <th colSpan={n + 1} scope="colgroup">
              {KIND_LABEL[kind]}
            </th>
          </tr>
          {cards.map((c) => {
            const out = ruledOut(marks, c.id)
            const env = inEnvelope(marks, c.id, n)
            return (
              <tr key={c.id} className={`${out ? 'out' : ''} ${env ? 'env' : ''}`}>
                <th scope="row">{c.name}</th>
                {view.players.map((p) => {
                  const locked = auto[c.id]?.[p.index] !== undefined
                  const m = marks[c.id]?.[p.index]
                  return (
                    <td key={p.playerId}>
                      <button
                        className={`my-mark ${m ?? ''} ${locked ? 'auto' : ''}`}
                        disabled={locked}
                        onClick={() => onCycle(c.id, p.index)}
                        aria-label={`${c.name}, ${p.name}: ${m === 'tem' ? 'tem' : m === 'nao' ? 'não tem' : m === 'talvez' ? 'talvez' : 'sem marca'}`}
                      >
                        <MarkGlyph m={m} />
                      </button>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      ))}
    </table>
  )
}

function suggestionLine(h: SuggestionView, v: MysteryView): string {
  const name = (i: number) => (i === v.you?.index ? 'você' : v.players[i]?.name ?? 'alguém')
  if (h.shownBy === null) return 'Ninguém tinha nenhuma.'
  const shown = h.card ? `: ${cardById(h.card)?.name}` : ''
  return `${name(h.shownBy)} mostrou para ${name(h.by)}${shown}.`
}

/** Mistério: as suas cartas e o caderno; o palpite em andamento, escolher e mostrar carta. */
export function MysteryScene({ view, onAct }: MysterySceneProps) {
  const me = view.you?.index ?? null
  const myTurn = me !== null && view.turn === me
  const auto = useMemo(() => autoMarks(view), [view])
  const [manual, cycle] = useManualMarks(view)
  const marks = useMemo(() => merge(auto, manual), [auto, manual])
  const [pick, setPick] = useState<Partial<Triple>>({})
  const [sure, setSure] = useState(false)

  useEffect(() => {
    setSure(false)
    if (!myTurn) setPick({})
  }, [myTurn, view.phase])

  const full = !!(pick.quem && pick.onde && pick.como)
  const name = (i: number) => (i === me ? 'Você' : view.players[i]?.name ?? 'Alguém')
  const cur = view.current

  return (
    <div className="my-scene">
      <section className="my-left">
        <h3 className="pixel-font">Suas cartas</h3>
        <div className="my-hand">
          {view.myCards.length ? view.myCards.map((id) => <MysteryCardTile key={id} id={id} small />) : <p className="small muted">Você está assistindo.</p>}
        </div>
        {me !== null && <Notebook view={view} marks={marks} auto={auto} onCycle={cycle} />}
      </section>

      <section className="my-right">
        <ul className="my-players">
          {view.players.map((p) => (
            <li key={p.playerId} className={`${view.turn === p.index ? 'turn' : ''} ${view.refuter === p.index ? 'showing' : ''} ${p.out ? 'out' : ''}`}>
              <span>{name(p.index)}</span>
              <small>
                {p.out ? 'errou a acusação' : `${p.cards} cartas`}
                {p.away ? ' · fora' : ''}
              </small>
            </li>
          ))}
        </ul>

        {cur && (
          <div className="my-current">
            <strong className="pixel-font">{name(cur.by)} palpitou</strong>
            <div className="my-row">
              {[cur.quem, cur.onde, cur.como].map((id) => (
                <MysteryCardTile key={id} id={id} on={cur.card === id} />
              ))}
            </div>
            <p className="small">
              {view.phase === 'mostrar' && view.refuter !== null
                ? view.refuter === me
                  ? 'Você tem mais de uma: escolha qual mostrar.'
                  : `Esperando ${name(view.refuter)} mostrar uma carta.`
                : suggestionLine(cur, view)}
            </p>
            {view.myChoices.length > 0 && (
              <div className="my-row">
                {view.myChoices.map((id) => (
                  <MysteryCardTile key={id} id={id} onClick={() => onAct({ type: 'show', card: id })} />
                ))}
              </div>
            )}
          </div>
        )}

        {myTurn && (view.phase === 'palpite' || view.phase === 'depois') && (
          <div className="my-pick">
            <strong className="pixel-font">{view.phase === 'palpite' ? 'Sua vez: escolha quem, onde e com o quê' : 'Quer acusar?'}</strong>
            {GROUPS.map(([kind, cards]) => (
              <div key={kind} className="my-pick-row" role="group" aria-label={KIND_LABEL[kind]}>
                <span className="my-pick-label">{KIND_LABEL[kind]}</span>
                <div className="my-row wrap">
                  {cards.map((c) => (
                    <MysteryCardTile
                      key={c.id}
                      id={c.id}
                      small
                      on={pick[kind] === c.id}
                      dim={ruledOut(marks, c.id)}
                      onClick={() => setPick((p) => ({ ...p, [kind]: c.id }))}
                    />
                  ))}
                </div>
              </div>
            ))}
            <div className="my-actions">
              {view.phase === 'palpite' && (
                <button className="primary" disabled={!full} onClick={() => onAct({ type: 'suggest', ...(pick as Triple) })}>
                  Palpitar
                </button>
              )}
              <button
                className={sure ? 'danger' : ''}
                disabled={!full}
                onClick={() => {
                  if (!sure) return setSure(true)
                  setSure(false)
                  onAct({ type: 'accuse', ...(pick as Triple) })
                }}
              >
                {sure ? 'Confirmar: errou, sai do jogo' : 'Acusar'}
              </button>
              <button onClick={() => onAct({ type: 'end' })}>{view.phase === 'palpite' ? 'Passar a vez' : 'Terminar a vez'}</button>
            </div>
          </div>
        )}

        {view.history.length > 0 && (
          <ol className="my-history" aria-label="Palpites">
            {[...view.history].reverse().slice(0, 8).map((h, k) => (
              <li key={view.history.length - k}>
                <b>{name(h.by)}</b>: {[h.quem, h.onde, h.como].map((id) => cardById(id)?.name).join(', ')}
                <small> · {suggestionLine(h, view)}</small>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
