/** Фирменный знак Store Scan: видоискатель + штрихкод + луч сканера */
export function LogoMark({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id="ss-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14123A" />
          <stop offset="1" stopColor="#5B3DF5" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#ss-bg)" />
      <g fill="none" stroke="#fff" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round">
        <path d="M112 176v-40a24 24 0 0 1 24-24h40" />
        <path d="M336 112h40a24 24 0 0 1 24 24v40" />
        <path d="M400 336v40a24 24 0 0 1-24 24h-40" />
        <path d="M176 400h-40a24 24 0 0 1-24-24v-40" />
      </g>
      <g fill="#fff">
        <rect x="166" y="178" width="16" height="156" rx="3" />
        <rect x="194" y="178" width="8" height="156" rx="3" />
        <rect x="214" y="178" width="22" height="156" rx="3" />
        <rect x="248" y="178" width="8" height="156" rx="3" />
        <rect x="268" y="178" width="16" height="156" rx="3" />
        <rect x="296" y="178" width="8" height="156" rx="3" />
        <rect x="316" y="178" width="22" height="156" rx="3" />
      </g>
      <rect x="134" y="250" width="244" height="12" rx="6" fill="#19E3B1" />
    </svg>
  )
}

/** Логотип со словесным знаком */
export function Logo({ size = 56, light = false, tagline = false }: { size?: number; light?: boolean; tagline?: boolean }) {
  return (
    <div className={'logo-lockup' + (light ? ' light' : '')}>
      <LogoMark size={size} />
      <div>
        <div className="wordmark" style={{ fontSize: size * 0.5 }}>
          Store<span>Scan</span>
        </div>
        {tagline && <div className="tagline">Сканируй. Продавай. Считай.</div>}
      </div>
    </div>
  )
}
