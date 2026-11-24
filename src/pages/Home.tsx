import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LogoMark } from '../components/Logo'
import { money, plural, startOfDay } from '../lib/format'
import { summarize, type Summary } from '../lib/reports'
import { useStore } from '../lib/store'
import { canManage, ROLE_LABEL } from '../lib/types'

const TILES = [
  { to: '/sale', icon: '🛒', title: 'Продажа', cls: 't-sale', all: true },
  { to: '/products', icon: '📚', title: 'База товаров', cls: 't-products', all: true },
  { to: '/receipt', icon: '📦', title: 'Приход товара', cls: 't-receipt', all: false },
  { to: '/audit', icon: '📋', title: 'Ревизия', cls: 't-audit', all: false },
  { to: '/reports', icon: '📊', title: 'Финансовые отчёты', cls: 't-reports', all: true },
  { to: '/returns', icon: '↩️', title: 'Списания и возвраты', cls: 't-returns', all: true },
]

export default function Home() {
  const { backend, profile, shopName, products } = useStore()
  const [today, setToday] = useState<Summary | null>(null)
  const manager = canManage(profile.role)

  useEffect(() => {
    let alive = true
    const load = () => backend.listOperations({ from: startOfDay(new Date()).toISOString(), types: ['sale', 'return'] })
      .then((ops) => alive && setToday(summarize(ops)))
      .catch(() => undefined)
    load()
    const t = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [backend])

  const low = products.filter((p) => !p.archived && p.stock <= 0).length

  return (
    <div className="page home">
      <header className="home-head">
        <div className="home-brand">
          <div className="home-app"><LogoMark size={22} /> Store Scan</div>
          <div className="home-shop">{shopName}</div>
          <div className="home-user">{profile.name === ROLE_LABEL[profile.role] ? profile.name : `${profile.name} · ${ROLE_LABEL[profile.role]}`}{backend.mode === 'local' ? ' · только этот телефон' : ''}</div>
        </div>
        <Link to="/settings" className="icon-btn light" aria-label="Настройки">⚙️</Link>
      </header>

      <Link to="/reports" className="today-card">
        <div className="today-label">Сегодня</div>
        <div className="today-sum">{today ? money(today.revenue) : '…'}</div>
        {today && (
          <div className="today-row">
            <span>{today.salesCount} {plural(today.salesCount, ['продажа', 'продажи', 'продаж'])}</span>
            <span>💵 {money(today.net.cash)}</span>
            <span>🟥 {money(today.net.kaspi)}</span>
            <span>🏦 {money(today.net.bank)}</span>
          </div>
        )}
      </Link>

      <main className="tiles">
        {TILES.filter((t) => t.all || manager).map((t) => (
          <Link key={t.to} to={t.to} className={'tile ' + t.cls}>
            <span className="tile-icon">{t.icon}</span>
            <span className="tile-title">{t.title}</span>
          </Link>
        ))}
      </main>

      <div className="home-links">
        <Link to="/history" className="btn btn-lg wide">🕘 История операций</Link>
        {manager && low > 0 && (
          <Link to="/products?filter=out" className="warn-line">⚠️ Нет в наличии: {low} товар(ов)</Link>
        )}
      </div>
    </div>
  )
}
