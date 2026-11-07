import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Jan, PixelTv } from './Pixel'
import type { PoseName } from './pixelData'
import { buildGrid, findPath, nearestFree, reachable, regions, type Box, type Grid } from './roamGrid'

/** Tamanho em múltiplos de 24 (pixel nítido), pela largura da janela. Jan e TV usam o mesmo. */
function sizeForViewport(w: number): number {
  if (w >= 1600) return 192
  if (w >= 1024) return 144
  if (w >= 600) return 120
  return 96
}

function useSceneSize(): number {
  const [size, setSize] = useState(() => sizeForViewport(window.innerWidth))
  useEffect(() => {
    const on = () => setSize(sizeForViewport(window.innerWidth))
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/** A TV da Home: fica no lugar dela (obstáculo para o Jan) e liga logo ao carregar. */
export function HomeTv() {
  const size = useSceneSize()
  const [on, setOn] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setOn(true), 700)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <div className="hero-pixels" data-roam-tv aria-hidden="true" style={{ width: size, height: size }}>
      <PixelTv on={on} size={size} />
    </div>
  )
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

// ---------------- o Jan andando pela página ----------------

/**
 * Camada que cobre a página inteira. O Jan anda por todo o espaço livre (margens, áreas
 * vazias, embaixo do formulário), desviando do conteúdo por um caminho calculado numa
 * grade. O mapa é refeito quando a janela ou o conteúdo mudam (ResizeObserver +
 * MutationObserver), então funciona em qualquer largura. Movimento reduzido: fica parado.
 */
export function RoamingJan({ pageRef, contentRef }: { pageRef: RefObject<HTMLElement | null>; contentRef: RefObject<HTMLElement | null> }) {
  const size = useSceneSize()
  const reduced = usePrefersReducedMotion()
  const walkerRef = useRef<HTMLDivElement>(null)
  const [pose, setPose] = useState<PoseName>('remote')
  const [facing, setFacing] = useState<1 | -1>(1)
  const [ready, setReady] = useState(false)
  const [roaming, setRoaming] = useState(false)

  const grid = useRef<Grid | null>(null)
  const pos = useRef({ x: 0, y: 0 })
  // waypoints; `jump` = reaparece ali na hora (troca de área por fora da tela)
  const path = useRef<{ x: number; y: number; jump?: boolean }[]>([])
  const pageW = useRef(0)
  const pauseUntil = useRef(0)
  const placed = useRef(false)

  const place = () => {
    if (walkerRef.current) walkerRef.current.style.transform = `translate(${pos.current.x}px, ${pos.current.y}px)`
  }

  // monta o mapa: obstáculos = blocos de conteúdo (com folga) + a TV
  const rebuild = useCallback(() => {
    const page = pageRef.current
    const content = contentRef.current
    if (!page || !content) return
    const pr = page.getBoundingClientRect()
    const pad = 10
    const obstacles: Box[] = []
    const add = (el: Element) => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      // modais e popovers fixos cobrem a tela por cima: não são parte do "chão"
      if (getComputedStyle(el).position === 'fixed') return
      obstacles.push({ x: r.left - pr.left - pad, y: r.top - pr.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 })
    }
    for (const el of Array.from(content.children)) add(el)
    pageW.current = page.clientWidth
    const g = buildGrid(page.clientWidth, page.scrollHeight, size, obstacles)
    grid.current = g

    // primeira vez: começa ao lado esquerdo da TV, olhando para ela
    const tv = page.querySelector('[data-roam-tv]')
    if (!placed.current && tv) {
      const tr = tv.getBoundingClientRect()
      const want = { x: tr.left - pr.left - size - 8, y: tr.top - pr.top }
      const i = nearestFree(g, want.x, want.y)
      if (i >= 0) {
        pos.current = { x: (i % g.cols) * g.cell, y: Math.floor(i / g.cols) * g.cell }
        placed.current = true
        setFacing(tr.left - pr.left > pos.current.x ? 1 : -1)
        // sem espaço ao lado da TV (celular): começa longe dela, então nada de apontar o controle
        if (Math.hypot(pos.current.x - want.x, pos.current.y - want.y) > size * 1.5) setPose('idle')
      }
    }
    // se o lugar atual ficou ocupado (conteúdo cresceu), vai para a célula livre mais próxima
    const ci = Math.round(pos.current.y / g.cell) * g.cols + Math.round(pos.current.x / g.cell)
    if (!g.free[ci]) {
      const i = nearestFree(g, pos.current.x, pos.current.y)
      if (i >= 0) pos.current = { x: (i % g.cols) * g.cell, y: Math.floor(i / g.cols) * g.cell }
      path.current = []
    }
    // caminhos antigos podem atravessar o conteúdo novo
    path.current = []
    place()
    setReady(placed.current && g.free.some((f) => f === 1))
  }, [pageRef, contentRef, size])

  useEffect(() => {
    rebuild()
    let t = 0
    const later = () => {
      window.clearTimeout(t)
      t = window.setTimeout(rebuild, 120)
    }
    const ro = new ResizeObserver(later)
    if (pageRef.current) ro.observe(pageRef.current)
    if (contentRef.current) ro.observe(contentRef.current)
    const mo = new MutationObserver(later)
    if (contentRef.current) mo.observe(contentRef.current, { childList: true, subtree: true })
    window.addEventListener('resize', later)
    return () => {
      window.clearTimeout(t)
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', later)
    }
  }, [rebuild, pageRef, contentRef])

  // abertura: aponta o controle para a TV; depois começa a passear
  useEffect(() => {
    const t = window.setTimeout(() => {
      setPose('idle')
      if (!reduced) {
        pauseUntil.current = performance.now() + 800
        setRoaming(true)
      }
    }, 2800)
    return () => window.clearTimeout(t)
  }, [reduced])

  useEffect(() => {
    if (!roaming || reduced) return
    let raf = 0
    let last = performance.now()
    let walking = false
    const speed = size * 0.5

    const cellXY = (g: Grid, i: number) => ({ x: (i % g.cols) * g.cell, y: Math.floor(i / g.cols) * g.cell })
    const toWaypoints = (g: Grid, cells: number[]) => cells.slice(1).map((i) => cellXY(g, i))

    /**
     * Troca de área livre: anda até a borda da tela, sai, e entra pela borda na outra área.
     * Necessário em telas estreitas, onde o conteúdo ocupa a largura toda e separa as áreas.
     */
    const planHop = (g: Grid, from: number): boolean => {
      const { label, sizes } = regions(g)
      const here = label[from]
      const edge = (i: number) => i % g.cols === 0 || i % g.cols === g.cols - 1
      const others = sizes.map((n, id) => ({ n, id })).filter((r) => r.id !== here && r.n >= 4)
      if (others.length === 0) return false
      const dest = others[Math.floor(Math.random() * others.length)].id
      const exits: number[] = []
      const entries: number[] = []
      for (let i = 0; i < label.length; i++) {
        if (!edge(i)) continue
        if (label[i] === here) exits.push(i)
        else if (label[i] === dest) entries.push(i)
      }
      if (!exits.length || !entries.length) return false
      const exit = exits[Math.floor(Math.random() * exits.length)]
      const entry = entries[Math.floor(Math.random() * entries.length)]
      const toExit = findPath(g, from, exit)
      if (!toExit) return false
      const a = cellXY(g, exit)
      const b = cellXY(g, entry)
      const offA = exit % g.cols === 0 ? -size - 12 : pageW.current + 12
      const offB = entry % g.cols === 0 ? -size - 12 : pageW.current + 12
      // e passeia um pouco do outro lado
      const inside = reachable(g, entry)
      const end = inside[Math.floor(Math.random() * inside.length)]
      const after = findPath(g, entry, end) ?? [entry]
      path.current = [
        ...toWaypoints(g, toExit),
        { x: offA, y: a.y },
        { x: offB, y: b.y, jump: true },
        b,
        ...toWaypoints(g, after)
      ]
      return true
    }

    const planNext = (): boolean => {
      const g = grid.current
      if (!g) return false
      const from = Math.round(pos.current.y / g.cell) * g.cols + Math.round(pos.current.x / g.cell)
      const options = reachable(g, from)
      // área pequena ou de vez em quando: vai visitar outra área livre
      if ((options.length < 12 || Math.random() < 0.3) && planHop(g, from)) return true
      if (options.length < 2) return false
      // prefere destinos a uma boa distância (caminhadas que valem a pena)
      let to = options[Math.floor(Math.random() * options.length)]
      for (let tries = 0; tries < 6; tries++) {
        const cand = options[Math.floor(Math.random() * options.length)]
        const dx = (cand % g.cols) - (from % g.cols)
        const dy = Math.floor(cand / g.cols) - Math.floor(from / g.cols)
        if (Math.hypot(dx, dy) * g.cell > size * 1.5) {
          to = cand
          break
        }
      }
      const cells = findPath(g, from, to)
      if (!cells || cells.length < 2) return false
      path.current = toWaypoints(g, cells)
      return true
    }

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (now >= pauseUntil.current) {
        if (path.current.length === 0) {
          if (walking) {
            walking = false
            pauseUntil.current = now + rand(1400, 4000)
            setPose(Math.random() < 0.25 ? 'wave' : 'idle')
          } else if (planNext()) {
            walking = true
            setPose('walk')
          } else {
            pauseUntil.current = now + 1500
          }
        } else {
          const next = path.current[0]
          if (next.jump) {
            pos.current = { x: next.x, y: next.y }
            path.current.shift()
            place()
            raf = requestAnimationFrame(tick)
            return
          }
          const dx = next.x - pos.current.x
          const dy = next.y - pos.current.y
          const dist = Math.hypot(dx, dy)
          const stepLen = speed * dt
          if (Math.abs(dx) > 1) setFacing(dx > 0 ? 1 : -1)
          if (dist <= stepLen) {
            pos.current = { ...next }
            path.current.shift()
          } else {
            pos.current = { x: pos.current.x + (dx / dist) * stepLen, y: pos.current.y + (dy / dist) * stepLen }
          }
          place()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [roaming, reduced, size])

  // clicar no Jan: ele para e acena, depois segue o caminho
  const poke = useCallback(() => {
    pauseUntil.current = performance.now() + 1800
    setPose('wave')
    window.setTimeout(() => setPose((p) => (p === 'wave' ? (path.current.length ? 'walk' : 'idle') : p)), 1800)
  }, [])

  return (
    <div className="roam-layer" aria-hidden="true">
      <div className="jan-walker" ref={walkerRef} onClick={poke} style={{ visibility: ready ? 'visible' : 'hidden' }}>
        <div className="jan-facing" style={{ transform: `scaleX(${facing})` }}>
          <Jan pose={pose} size={size} ground={false} />
        </div>
      </div>
    </div>
  )
}
