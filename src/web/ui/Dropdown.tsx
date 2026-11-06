import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'

export interface DropdownOption {
  value: string
  /** nome completo (na lista) */
  label: string
  /** nome curto (no botão); padrão = label */
  short?: string
  sub?: string
  icon?: IconName
}

interface Props {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  ariaLabel: string
  icon: IconName
  /** abre para cima quando está no dock */
  placement?: 'up' | 'down'
  tip?: string
  /** texto fixo no botão (em vez do nome da opção) */
  buttonText?: ReactNode
}

/** Select próprio: listbox acessível com teclado, clique fora e animação. */
export function Dropdown({ value, options, onChange, ariaLabel, icon, placement = 'down', tip, buttonText }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const selected = Math.max(0, options.findIndex((o) => o.value === value))
  const current = options[selected]

  const openList = () => {
    setActive(selected)
    setOpen(true)
  }
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) btn.current?.focus()
  }
  const pick = (i: number) => {
    const o = options[i]
    if (o) onChange(o.value)
    close()
  }

  // foca a lista ao abrir; fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    list.current?.focus()
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  // mantém a opção ativa visível
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, id])

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      openList()
    }
  }

  const onListKey = (e: KeyboardEvent) => {
    const n = options.length
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((a) => (a + 1) % n)
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((a) => (a - 1 + n) % n)
        break
      case 'Home':
        e.preventDefault()
        setActive(0)
        break
      case 'End':
        e.preventDefault()
        setActive(n - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        pick(active)
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        close()
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const k = e.key.toLowerCase()
          const from = active + 1
          const order = [...options.keys()].map((_, i) => (from + i) % n)
          const hit = order.find((i) => options[i].label.toLowerCase().startsWith(k))
          if (hit !== undefined) setActive(hit)
        }
    }
  }

  return (
    <div ref={root} className={`dd ${placement} ${open ? 'open' : ''}`}>
      <button
        ref={btn}
        type="button"
        className="dd-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${current?.label ?? ''}`}
        data-tip={open ? undefined : tip}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onButtonKey}
      >
        <Icon name={icon} size={20} />
        <span className="lbl">{buttonText ?? current?.short ?? current?.label}</span>
        <span className="caret">
          <Icon name="chevron" size={16} />
        </span>
      </button>
      {open && (
        <div
          ref={list}
          className="dd-panel"
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === selected}
              className={`dd-opt ${i === active ? 'active' : ''} ${i === selected ? 'selected' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
              title={o.label}
            >
              <span className="dd-ico">
                <Icon name={o.icon ?? icon} size={18} />
              </span>
              <span className="dd-text">
                <strong>{o.label}</strong>
                {o.sub && <small>{o.sub}</small>}
              </span>
              {i === selected && (
                <span className="dd-check">
                  <Icon name="check" size={18} />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
