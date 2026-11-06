/** Wordmark animado. */
export function Brand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={`brand ${size}`}>
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
      </span>
      <span className="brand-text">JanJa</span>
    </span>
  )
}

/** Loader de órbitas para os estados de espera. */
export function Loader() {
  return (
    <div className="loader" aria-hidden="true">
      <span className="orbit o1" />
      <span className="orbit o2" />
      <span className="orbit o3" />
      <span className="core" />
    </div>
  )
}
