import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { money } from '../lib/format'

/* ============ Анимированное число ============ */
export function CountUp({ value, format = money, duration = 700 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || a === value) {
      setShown(value); from.current = value; return
    }
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration)
      const e = 1 - Math.pow(1 - k, 3)
      setShown(a + (value - a) * e)
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); from.current = value }
  }, [value, duration])
  return <span className="count-up">{format(Math.round(shown * 100) / 100)}</span>
}

/* ============ Полоса «чем платили» ============ */
const PAY_COLORS = { cash: '#0E9F6E', kaspi: '#F14635', bank: '#5B3DF5' } as const
const PAY_NAMES = { cash: 'Наличные', kaspi: 'Kaspi', bank: 'Банки' } as const

export function PaySplitBar({ cash, kaspi, bank, dark }: { cash: number; kaspi: number; bank: number; dark?: boolean }) {
  const parts = (['cash', 'kaspi', 'bank'] as const).map((k) => ({ k, v: Math.max(0, { cash, kaspi, bank }[k]) }))
  const total = parts.reduce((s, p) => s + p.v, 0)
  return (
    <div className={'split' + (dark ? ' dark' : '')}>
      <div className="split-bar" role="img" aria-label={parts.map((p) => `${PAY_NAMES[p.k]} ${money(p.v)}`).join(', ')}>
        {total === 0 ? <span className="split-empty" /> : parts.filter((p) => p.v > 0).map((p) => (
          <span key={p.k} className="split-seg" style={{ flexGrow: p.v, background: PAY_COLORS[p.k] }}
            title={`${PAY_NAMES[p.k]}: ${money(p.v)} (${Math.round((p.v / total) * 100)}%)`} />
        ))}
      </div>
      <div className="split-legend">
        {parts.map((p) => (
          <span key={p.k}><i style={{ background: PAY_COLORS[p.k] }} />{PAY_NAMES[p.k]} <b>{money(p.v)}</b></span>
        ))}
      </div>
    </div>
  )
}

/* ============ Мини-столбики по дням (одна серия) ============ */
export function MiniBars({ data, height = 96 }: { data: { label: string; value: number; hint?: string }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const best = data.reduce((b, d, i) => (d.value > (data[b]?.value ?? -1) ? i : b), 0)
  const shownIdx = hover ?? (data.length ? data.length - 1 : null)
  const shown = shownIdx != null ? data[shownIdx] : null
  return (
    <div className="minibars">
      <div className="mb-readout">
        {shown ? <><b>{money(shown.value)}</b><span>{shown.hint ?? shown.label}</span></> : null}
      </div>
      <div className="mb-plot" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <button key={i} type="button" className={'mb-col' + (i === shownIdx ? ' on' : '')}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)}
            aria-label={`${d.hint ?? d.label}: ${money(d.value)}`}>
            <span className="mb-bar" style={{ height: `${Math.max(d.value > 0 ? 4 : 0, (d.value / max) * 100)}%`, animationDelay: `${i * 40}ms` }}>
              {i === best && d.value > 0 && data.length > 2 && <em className="mb-best">★</em>}
            </span>
          </button>
        ))}
      </div>
      <div className="mb-axis">{data.map((d, i) => <span key={i}>{d.label}</span>)}</div>
    </div>
  )
}

/* ============ Конфетти ============ */
export function Confetti({ count = 70 }: { count?: number }) {
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.25,
    dur: 1.1 + Math.random() * 0.9,
    rot: Math.random() * 360,
    drift: (Math.random() - 0.5) * 160,
    color: ['#5B3DF5', '#19E3B1', '#F14635', '#FFC53D', '#0E9F6E', '#8B6CFF'][i % 6],
    w: 6 + Math.random() * 6,
    round: Math.random() > 0.6,
  })), [count])
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null
  return createPortal(
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i key={i} style={{
          left: p.left + '%', background: p.color, width: p.w, height: p.round ? p.w : p.w * 0.45,
          borderRadius: p.round ? '50%' : 2, animationDelay: p.delay + 's', animationDuration: p.dur + 's',
          ['--rot' as string]: p.rot + 'deg', ['--drift' as string]: p.drift + 'px',
        }} />
      ))}
    </div>,
    document.body,
  )
}

/** Галочка, которая «рисуется» */
export function SuccessCheck() {
  return (
    <svg className="success-check" viewBox="0 0 96 96" aria-hidden="true">
      <circle cx="48" cy="48" r="44" />
      <path d="M28 50l13 13 27-29" />
    </svg>
  )
}

/* ============ Иллюстрации пустых состояний ============ */
export type ArtKind = 'cart' | 'box' | 'clipboard' | 'chart' | 'clock' | 'search' | 'returns'

export function Illustration({ kind }: { kind: ArtKind }) {
  return (
    <svg className="illu" viewBox="0 0 200 140" aria-hidden="true">
      <ellipse cx="100" cy="124" rx="64" ry="8" fill="#14123A" opacity=".06" />
      <circle cx="100" cy="66" r="54" fill="#EEEAFF" />
      <circle cx="160" cy="28" r="6" fill="#19E3B1" className="illu-float" />
      <circle cx="40" cy="40" r="4" fill="#F14635" opacity=".7" className="illu-float d2" />
      <path d="M46 102l4-4m0 4l-4-4" stroke="#5B3DF5" strokeWidth="2.5" strokeLinecap="round" className="illu-float d3" />
      <g className="illu-main">{ART[kind]}</g>
    </svg>
  )
}

const ART: Record<ArtKind, React.ReactNode> = {
  cart: (
    <g>
      <path d="M58 44h12l10 44h44l8-30H76" fill="none" stroke="#14123A" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="82" y="56" width="44" height="24" rx="5" fill="#5B3DF5" />
      <rect x="90" y="62" width="4" height="12" rx="1" fill="#fff" /><rect x="98" y="62" width="2" height="12" fill="#fff" />
      <rect x="104" y="62" width="6" height="12" rx="1" fill="#fff" /><rect x="114" y="62" width="3" height="12" fill="#fff" />
      <circle cx="86" cy="100" r="6" fill="#14123A" /><circle cx="118" cy="100" r="6" fill="#14123A" />
    </g>
  ),
  box: (
    <g>
      <path d="M100 32l38 18v40l-38 18-38-18V50z" fill="#5B3DF5" />
      <path d="M100 32l38 18-38 18-38-18z" fill="#8B6CFF" />
      <path d="M100 68v40" stroke="#4527D9" strokeWidth="3" />
      <path d="M81 41l38 18v12" stroke="#19E3B1" strokeWidth="6" fill="none" />
    </g>
  ),
  clipboard: (
    <g>
      <rect x="70" y="30" width="60" height="78" rx="8" fill="#fff" stroke="#14123A" strokeWidth="4" />
      <rect x="86" y="24" width="28" height="12" rx="4" fill="#5B3DF5" />
      <path d="M80 54l5 5 9-10M80 74l5 5 9-10" stroke="#0E9F6E" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="100" y="52" width="22" height="5" rx="2.5" fill="#C9C4F2" /><rect x="100" y="72" width="22" height="5" rx="2.5" fill="#C9C4F2" />
      <rect x="80" y="90" width="42" height="5" rx="2.5" fill="#C9C4F2" />
    </g>
  ),
  chart: (
    <g>
      <rect x="62" y="34" width="76" height="66" rx="10" fill="#fff" stroke="#14123A" strokeWidth="4" />
      <rect x="74" y="70" width="10" height="20" rx="3" fill="#C9C4F2" />
      <rect x="90" y="58" width="10" height="32" rx="3" fill="#8B6CFF" />
      <rect x="106" y="48" width="10" height="42" rx="3" fill="#5B3DF5" />
      <path d="M72 58l16-10 14 6 20-14" stroke="#19E3B1" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  clock: (
    <g>
      <circle cx="100" cy="66" r="34" fill="#fff" stroke="#14123A" strokeWidth="4" />
      <path d="M100 46v20l14 9" stroke="#5B3DF5" strokeWidth="5" fill="none" strokeLinecap="round" />
      <circle cx="100" cy="66" r="4" fill="#14123A" />
    </g>
  ),
  search: (
    <g>
      <circle cx="94" cy="60" r="26" fill="#fff" stroke="#14123A" strokeWidth="5" />
      <path d="M113 79l18 18" stroke="#5B3DF5" strokeWidth="9" strokeLinecap="round" />
      <path d="M84 52h20M84 62h12" stroke="#C9C4F2" strokeWidth="4" strokeLinecap="round" />
    </g>
  ),
  returns: (
    <g>
      <rect x="66" y="44" width="68" height="56" rx="8" fill="#5B3DF5" />
      <path d="M88 72h26a10 10 0 0 1 0 20h-8" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M96 62l-10 10 10 10" stroke="#19E3B1" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
}

/* ============ Приветствие по времени суток ============ */
export function greeting(d = new Date()) {
  const h = d.getHours()
  if (h < 5) return 'Доброй ночи'
  if (h < 12) return 'Доброе утро'
  if (h < 18) return 'Добрый день'
  return 'Добрый вечер'
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '🙂'
}
