import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { money, num, parseNum } from '../lib/format'
import { useStore } from '../lib/store'
import type { Product } from '../lib/types'
import Scanner, { type ScanFeedback } from './Scanner'

export function Page({ title, back = '/', actions, children, footer }: {
  title: string; back?: string | false; actions?: ReactNode; children: ReactNode; footer?: ReactNode
}) {
  const nav = useNavigate()
  return (
    <div className="page">
      <header className="topbar">
        {back !== false ? (
          <button className="icon-btn" onClick={() => nav(back)} aria-label="Назад">‹</button>
        ) : <span className="icon-gap" />}
        <h1>{title}</h1>
        <div className="topbar-actions">{actions}</div>
      </header>
      <main className="content">{children}</main>
      {footer && <footer className="footer-bar">{footer}</footer>}
    </div>
  )
}

export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('no-scroll')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('no-scroll')
    }
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** Поле ввода числа, удобное на телефоне (цифровая клавиатура, запятая или точка) */
export function NumInput({ value, onChange, placeholder, autoFocus, decimal = true, className, id, onEnter }: {
  value: number | null; onChange: (v: number) => void; placeholder?: string; autoFocus?: boolean; decimal?: boolean
  className?: string; id?: string; onEnter?: () => void
}) {
  const [text, setText] = useState(value == null || Number.isNaN(value) ? '' : String(value))
  useEffect(() => {
    if (parseNum(text) !== value) setText(value == null || Number.isNaN(value) ? '' : String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input
      id={id}
      className={'num-input ' + (className ?? '')}
      inputMode={decimal ? 'decimal' : 'numeric'}
      placeholder={placeholder}
      autoFocus={autoFocus}
      value={text}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter() } }}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.,\s-]/g, '')
        setText(t)
        onChange(parseNum(t))
      }}
    />
  )
}

export function QtyStepper({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, Math.round((value - 1) * 1000) / 1000))} aria-label="Меньше">−</button>
      <NumInput value={value} onChange={onChange} />
      <button type="button" onClick={() => onChange(Math.round((value + 1) * 1000) / 1000)} aria-label="Больше">+</button>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function Empty({ icon = '📭', text, children }: { icon?: string; text: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div>{text}</div>
      {children}
    </div>
  )
}

export function StockBadge({ p }: { p: Product }) {
  const cls = p.stock <= 0 ? 'badge red' : p.stock <= 3 ? 'badge orange' : 'badge green'
  return <span className={cls}>{num(p.stock)} {p.unit}</span>
}

/**
 * Поиск товара: по названию / штрихкоду вручную и сканированием камерой.
 * Поддерживает и внешние сканеры-«клавиатуры» (вводят код и нажимают Enter).
 */
export function ProductFinder({ onPick, onScan, scanTitle, continuous = true, placeholder, showPrice = 'sale', autoFocus }: {
  onPick: (p: Product) => void
  onScan: (code: string) => ScanFeedback | void | Promise<ScanFeedback | void>
  scanTitle?: string
  continuous?: boolean
  placeholder?: string
  showPrice?: 'sale' | 'purchase' | 'none'
  autoFocus?: boolean
}) {
  const { search, findByBarcode } = useStore()
  const [q, setQ] = useState('')
  const [scan, setScan] = useState(false)
  const results = q.trim() ? search(q, { limit: 40 }) : []

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const code = q.trim()
    if (!code) return
    const p = findByBarcode(code)
    if (p) { onPick(p); setQ(''); return }
    if (results.length === 1) { onPick(results[0]); setQ(''); return }
    if (/^\d{6,}$/.test(code)) { onScan(code); setQ('') }
  }

  return (
    <div className="finder">
      <div className="finder-row">
        <form onSubmit={submit} className="finder-form">
          <input
            type="search"
            className="search-input"
            placeholder={placeholder ?? 'Поиск по названию или штрихкоду'}
            value={q}
            autoFocus={autoFocus}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>
        <button className="btn btn-scan" onClick={() => setScan(true)}>
          <span className="scan-ico">▥</span> Скан
        </button>
      </div>
      {q.trim() && (
        <div className="finder-results">
          {results.length === 0 && <div className="muted pad">Ничего не найдено</div>}
          {results.map((p) => (
            <button key={p.id} className="list-row" onClick={() => { onPick(p); setQ('') }}>
              <div className="row-main">
                <div className="row-title">{p.name}</div>
                <div className="row-sub">{p.barcode || 'без штрихкода'}</div>
              </div>
              <div className="row-right">
                {showPrice !== 'none' && <div className="row-price">{money(showPrice === 'sale' ? p.sale_price : p.purchase_price)}</div>}
                <StockBadge p={p} />
              </div>
            </button>
          ))}
        </div>
      )}
      {scan && <Scanner title={scanTitle} continuous={continuous} onDetect={onScan} onClose={() => setScan(false)} />}
    </div>
  )
}

export function useConfirm() {
  const [state, setState] = useState<{ text: string; resolve: (v: boolean) => void; danger?: boolean; ok?: string } | null>(null)
  const ask = (text: string, opts?: { danger?: boolean; ok?: string }) =>
    new Promise<boolean>((resolve) => setState({ text, resolve, ...opts }))
  const close = (v: boolean) => { state?.resolve(v); setState(null) }
  const node = state ? (
    <Modal title="Подтверждение" onClose={() => close(false)} footer={
      <>
        <button className="btn" onClick={() => close(false)}>Отмена</button>
        <button className={'btn ' + (state.danger ? 'btn-danger' : 'btn-primary')} onClick={() => close(true)}>{state.ok ?? 'Да'}</button>
      </>
    }>
      <p style={{ whiteSpace: 'pre-line' }}>{state.text}</p>
    </Modal>
  ) : null
  return { ask, node }
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="tabs">
      {items.map(([k, label]) => (
        <button key={k} className={'tab' + (k === value ? ' active' : '')} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  )
}
