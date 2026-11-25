import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CountUp, greeting, initials, MiniBars, PaySplitBar } from '../components/Lively'
import { LogoMark } from '../components/Logo'
import { addDays, dayKey, money, plural, round2, startOfDay } from '../lib/format'
import { summarize } from '../lib/reports'
import { useStore } from '../lib/store'
import { canManage, ROLE_LABEL, type Operation } from '../lib/types'

const WEEKDAY = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

export default function Home() {
  const { backend, profile, shopName, products } = useStore()
  const [ops, setOps] = useState<Operation[] | null>(null)
  const manager = canManage(profile.role)

  useEffect(() => {
    let alive = true
    const load = () => backend.listOperations({ from: addDays(startOfDay(new Date()), -6).toISOString(), types: ['sale', 'return'] })
      .then((o) => alive && setOps(o))
      .catch(() => undefined)
    load()
    const t = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [backend])

  const { today, yesterday, week, weekTotal } = useMemo(() => {
    const byDay = new Map<string, Operation[]>()
    for (const o of ops ?? []) {
      const k = dayKey(o.created_at)
      byDay.set(k, [...(byDay.get(k) ?? []), o])
    }
    const now = new Date()
    const today = summarize(byDay.get(dayKey(now)) ?? [])
    const yesterday = summarize(byDay.get(dayKey(addDays(now, -1))) ?? [])
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(startOfDay(now), i - 6)
      const s = summarize(byDay.get(dayKey(d)) ?? [])
      return { label: i === 6 ? 'сег' : WEEKDAY[d.getDay()], value: s.revenue, hint: d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) }
    })
    return { today, yesterday, week, weekTotal: round2(week.reduce((s, d) => s + d.value, 0)) }
  }, [ops])

  const active = products.filter((p) => !p.archived)
  const out = active.filter((p) => p.stock <= 0)
  const delta = yesterday.revenue > 0 ? Math.round(((today.revenue - yesterday.revenue) / yesterday.revenue) * 100) : null
  const auditDraft = (() => { try { return JSON.parse(localStorage.getItem('audit-draft') || 'null') as { items: unknown[] } | null } catch { return null } })()
  const cartDraft = (() => { try { return (JSON.parse(localStorage.getItem('sale-cart-draft') || '[]') as unknown[]).length } catch { return 0 } })()
  const dateText = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="page home">
      <header className="home-head">
        <div className="glow g1" /><div className="glow g2" />
        <div className="home-top">
          <div className="home-app"><LogoMark size={22} /> Store Scan</div>
          <Link to="/settings" className="avatar" aria-label="Настройки">{initials(profile.name)}</Link>
        </div>
        <div className="home-hello">{greeting()}, {profile.name.split(' ')[0]} 👋</div>
        <div className="home-sub">
          {shopName} · {dateText}
          {profile.name !== ROLE_LABEL[profile.role] && <> · {ROLE_LABEL[profile.role]}</>}
          {backend.mode === 'local' && ' · этот телефон'}
        </div>
      </header>

      <Link to="/reports" className="today-card">
        <div className="today-top">
          <span className="today-label">Выручка сегодня</span>
          {delta != null && (
            <span className={'delta ' + (delta >= 0 ? 'up' : 'down')}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% ко вчера</span>
          )}
        </div>
        <div className="today-sum">{ops ? <CountUp value={today.revenue} /> : <span className="skeleton w60" />}</div>
        <div className="today-chips">
          <span className="chip-soft">🧾 {today.salesCount} {plural(today.salesCount, ['продажа', 'продажи', 'продаж'])}</span>
          <span className="chip-soft">⌀ чек {money(today.avgCheck)}</span>
          {today.returnsCount > 0 && <span className="chip-soft warn">↩ {money(today.returnsSum)}</span>}
        </div>
        <PaySplitBar cash={today.net.cash} kaspi={today.net.kaspi} bank={today.net.bank} />
      </Link>

      <main className="tiles">
        <Link to="/sale" className="tile t-sale tile-hero">
          <span className="tile-bubble">🛒</span>
          <span className="tile-text">
            <span className="tile-title">Продажа</span>
            <span className="tile-sub">{cartDraft ? `В корзине ${cartDraft} поз. — продолжить` : 'Сканируйте товар камерой'}</span>
          </span>
          <span className="tile-cta">▥ Скан</span>
        </Link>
        <Link to="/products" className="tile t-products">
          <span className="tile-bubble">📚</span>
          <span className="tile-title">База товаров</span>
          <span className="tile-sub">{active.length} {plural(active.length, ['товар', 'товара', 'товаров'])}</span>
        </Link>
        {manager && (
          <Link to="/receipt" className="tile t-receipt">
            <span className="tile-bubble">📦</span>
            <span className="tile-title">Приход товара</span>
            <span className="tile-sub">Принять поставку</span>
          </Link>
        )}
        {manager && (
          <Link to="/audit" className="tile t-audit">
            <span className="tile-bubble">📋</span>
            <span className="tile-title">Ревизия</span>
            <span className="tile-sub">{auditDraft ? `Идёт: проверено ${auditDraft.items.length}` : 'Пересчитать остатки'}</span>
            {auditDraft && <span className="tile-dot" />}
          </Link>
        )}
        <Link to="/reports" className="tile t-reports">
          <span className="tile-bubble">📊</span>
          <span className="tile-title">Финансовые отчёты</span>
          <span className="tile-sub">{manager ? `7 дней: ${money(weekTotal)}` : 'Касса за сегодня'}</span>
        </Link>
        <Link to="/returns" className="tile t-returns">
          <span className="tile-bubble">↩️</span>
          <span className="tile-title">Списания и возвраты</span>
          <span className="tile-sub">Возврат, списание, отмена</span>
        </Link>
      </main>

      <div className="home-links">
        {manager && ops && (
          <section className="card week-card">
            <div className="card-head">
              <span>Продажи за 7 дней</span>
              <b>{money(weekTotal)}</b>
            </div>
            <MiniBars data={week} />
          </section>
        )}

        {manager && out.length > 0 && (
          <Link to="/products?filter=out" className="alert-card">
            <span className="alert-ico">⚠️</span>
            <span>
              <b>Нет в наличии: {out.length}</b>
              <span className="alert-sub">{out.slice(0, 3).map((p) => p.name).join(', ')}{out.length > 3 ? '…' : ''}</span>
            </span>
            <span className="alert-go">›</span>
          </Link>
        )}

        <Link to="/history" className="btn btn-lg wide btn-soft">🕘 История операций</Link>
      </div>
    </div>
  )
}
