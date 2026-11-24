import { useEffect, useMemo, useState } from 'react'
import OperationView from '../components/OperationView'
import { Empty, Page, Tabs } from '../components/ui'
import { exportXlsx, printDoc, type ReportDoc } from '../lib/export'
import { addDays, dateOnly, dateTime, dayKey, errorText, money, num, plural, round2, startOfDay } from '../lib/format'
import { byDay, movement, summarize, type Summary } from '../lib/reports'
import { useStore, useToast } from '../lib/store'
import { canManage, OP_ICON, OP_LABEL, PAY_LABEL, type Operation, type OpType } from '../lib/types'

type Period = 'today' | 'yesterday' | 'week' | 'month' | 'custom' | 'all'
type View = 'summary' | 'days' | 'ops' | 'goods' | 'stock'

function periodRange(p: Period, customFrom: string, customTo: string): { from?: Date; to?: Date; label: string } {
  const today = startOfDay(new Date())
  switch (p) {
    case 'today': return { from: today, to: addDays(today, 1), label: `Сегодня, ${dateOnly(today)}` }
    case 'yesterday': return { from: addDays(today, -1), to: today, label: `Вчера, ${dateOnly(addDays(today, -1))}` }
    case 'week': return { from: addDays(today, -6), to: addDays(today, 1), label: `Неделя: ${dateOnly(addDays(today, -6))} — ${dateOnly(today)}` }
    case 'month': {
      const from = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from, to: addDays(today, 1), label: `Месяц: ${dateOnly(from)} — ${dateOnly(today)}` }
    }
    case 'custom': {
      const from = customFrom ? startOfDay(new Date(customFrom + 'T00:00:00')) : today
      const to = addDays(customTo ? startOfDay(new Date(customTo + 'T00:00:00')) : today, 1)
      return { from, to, label: `Период: ${dateOnly(from)} — ${dateOnly(addDays(to, -1))}` }
    }
    case 'all': return { label: 'За всё время' }
  }
}

export default function Reports() {
  const { backend, profile, products, shopName, categories } = useStore()
  const toast = useToast()
  const manager = canManage(profile.role)
  const [period, setPeriod] = useState<Period>('today')
  const [view, setView] = useState<View>('summary')
  const [customFrom, setCustomFrom] = useState(dayKey(addDays(new Date(), -30)))
  const [customTo, setCustomTo] = useState(dayKey(new Date()))
  const [allOps, setAllOps] = useState<Operation[] | null>(null)
  const [typeFilter, setTypeFilter] = useState<OpType | 'all'>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const range = periodRange(manager ? period : 'today', customFrom, customTo)
  const fromIso = range.from?.toISOString()
  const toIso = range.to?.toISOString()

  useEffect(() => {
    setAllOps(null)
    backend.listOperations({ from: fromIso }).then(setAllOps).catch((e) => toast.error(errorText(e)))
  }, [backend, fromIso, toast, reloadKey])

  const ops = useMemo(() => (allOps ?? []).filter((o) => !toIso || o.created_at < toIso), [allOps, toIso])
  const after = useMemo(() => (allOps ?? []).filter((o) => toIso && o.created_at >= toIso), [allOps, toIso])
  const s = useMemo(() => summarize(ops), [ops])
  const days = useMemo(() => byDay(ops), [ops])
  const goods = useMemo(() => (view === 'goods' || view === 'summary' ? movement(products, ops, after) : []), [products, ops, after, view])

  const doc = (): ReportDoc => buildDoc(range.label, shopName, s, days, ops, manager ? movement(products, ops, after) : [], manager, products, categories)

  const exportExcel = () => exportXlsx(doc(), true).catch((e) => toast.error(errorText(e)))
  const exportPdf = () => {
    const d = doc()
    printDoc({ ...d, sections: d.sections.filter((x) => x.title !== 'Операции' && x.title !== 'Остатки товаров') })
  }

  const visibleOps = typeFilter === 'all' ? ops : ops.filter((o) => o.type === typeFilter)

  return (
    <Page title="Финансовые отчёты" actions={<button className="icon-btn" onClick={() => setReloadKey((k) => k + 1)} aria-label="Обновить">⟳</button>}>
      {manager ? (
        <div className="chips">
          {([['today', 'Сегодня'], ['yesterday', 'Вчера'], ['week', 'Неделя'], ['month', 'Месяц'], ['custom', 'Период'], ['all', 'Всё время']] as [Period, string][]).map(([k, l]) => (
            <button key={k} className={'chip' + (period === k ? ' active' : '')} onClick={() => setPeriod(k)}>{l}</button>
          ))}
        </div>
      ) : <div className="muted small">Кассиру доступен отчёт за сегодня.</div>}
      {manager && period === 'custom' && (
        <div className="grid2">
          <label className="field"><span className="field-label">С</span><input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
          <label className="field"><span className="field-label">По</span><input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
        </div>
      )}
      <div className="period-label">{range.label}</div>

      <Tabs value={view} onChange={setView} items={[
        ['summary', 'Сводка'], ['days', 'По дням'], ['ops', 'Операции'],
        ...(manager ? [['goods', 'Товары'], ['stock', 'Остатки']] as [View, string][] : []),
      ]} />

      {!allOps ? <div className="muted pad">Загрузка…</div> : (
        <>
          {view === 'summary' && <SummaryView s={s} manager={manager} />}

          {view === 'days' && (days.length === 0 ? <Empty icon="📊" text="Нет продаж за период" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>День</th><th>Продаж</th><th>Выручка</th><th>Нал.</th><th>Kaspi</th><th>Банки</th><th>Возвр.</th>{manager && <th>Прибыль</th>}</tr></thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.day}>
                      <td>{dateOnly(d.day + 'T00:00:00')}</td><td className="n">{d.salesCount}</td><td className="n"><b>{money(d.revenue)}</b></td>
                      <td className="n">{money(d.cash)}</td><td className="n">{money(d.kaspi)}</td><td className="n">{money(d.bank)}</td>
                      <td className="n">{money(d.returns)}</td>{manager && <td className="n">{money(d.profit)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {view === 'ops' && (
            <>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as OpType | 'all')}>
                <option value="all">Все операции ({ops.length})</option>
                {(Object.keys(OP_LABEL) as OpType[]).map((t) => <option key={t} value={t}>{OP_LABEL[t]}</option>)}
              </select>
              {visibleOps.length === 0 ? <Empty text="Нет операций" /> : (
                <div className="list">
                  {visibleOps.slice(0, 500).map((o) => <OpRow key={o.id} o={o} onClick={() => setOpen(o.id)} />)}
                </div>
              )}
            </>
          )}

          {view === 'goods' && (goods.length === 0 ? <Empty text="Движения товаров за период не было" /> : (
            <div className="table-wrap">
              <table className="table small-table">
                <thead><tr><th>Товар</th><th>Начало</th><th>Приход</th><th>Продано</th><th>Возвр.</th><th>Отм.</th><th>Спис.</th><th>Ревиз.</th><th>Конец</th></tr></thead>
                <tbody>
                  {goods.map((g) => (
                    <tr key={g.product_id}>
                      <td>{g.name}</td><td className="n">{num(g.start)}</td><td className="n">{num(g.receipt)}</td><td className="n">{num(g.sold)}</td>
                      <td className="n">{num(g.returned)}</td><td className="n">{num(g.cancelled)}</td><td className="n">{num(g.writeoff)}</td>
                      <td className="n">{g.audit > 0 ? '+' : ''}{num(g.audit)}</td><td className="n"><b>{num(g.end)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {view === 'stock' && <StockView />}

          <div className="row-gap pad">
            <button className="btn grow" onClick={exportExcel}>⬇️ Excel</button>
            <button className="btn grow" onClick={exportPdf}>🖨 PDF</button>
          </div>
        </>
      )}
      {open && <OperationView id={open} onClose={() => setOpen(null)} onChanged={() => setReloadKey((k) => k + 1)} />}
    </Page>
  )
}

export function OpRow({ o, onClick }: { o: Operation; onClick: () => void }) {
  const sign = o.type === 'return' ? '−' : ''
  return (
    <button className={'list-row' + (o.status === 'cancelled' ? ' cancelled' : '')} onClick={onClick}>
      <div className="row-main">
        <div className="row-title">{OP_ICON[o.type]} {OP_LABEL[o.type]} №{o.number}{o.status === 'cancelled' ? ' (отменена)' : ''}</div>
        <div className="row-sub">
          {dateTime(o.created_at)}{o.user_name ? ' · ' + o.user_name : ''}
          {o.payments.length > 0 && ' · ' + o.payments.map((p) => (p.method === 'bank' ? p.bank_name : PAY_LABEL[p.method])).join(' + ')}
        </div>
      </div>
      <div className="row-right"><div className="row-price">{sign}{money(o.total)}</div></div>
    </button>
  )
}

function SummaryView({ s, manager }: { s: Summary; manager: boolean }) {
  const banks = Object.entries(s.net.banks).filter(([, v]) => v !== 0)
  return (
    <div className="report">
      <div className="report-hero">
        <div className="muted">Выручка (продажи − возвраты)</div>
        <div className="hero-sum">{money(s.revenue)}</div>
        <div className="muted small">{s.salesCount} {plural(s.salesCount, ['продажа', 'продажи', 'продаж'])} · средний чек {money(s.avgCheck)} · продано {num(s.itemsSold)} ед.</div>
      </div>

      <div className="pay-cards">
        <div className="pay-card cash"><span>💵 Наличные</span><b>{money(s.net.cash)}</b></div>
        <div className="pay-card kaspi"><span>🟥 Kaspi</span><b>{money(s.net.kaspi)}</b></div>
        <div className="pay-card bank"><span>🏦 Другие банки</span><b>{money(s.net.bank)}</b></div>
      </div>
      {banks.length > 0 && (
        <div className="kv">
          {banks.map(([k, v]) => <div key={k}><span>🏦 {k}</span><b>{money(v)}</b></div>)}
        </div>
      )}

      <div className="section-title">Движение денег</div>
      <table className="table">
        <thead><tr><th>Способ</th><th>Продажи</th><th>Возвраты</th><th>Итого</th></tr></thead>
        <tbody>
          {(['cash', 'kaspi', 'bank'] as const).map((m) => (
            <tr key={m}><td>{PAY_LABEL[m]}</td><td className="n">{money(s.sales[m])}</td><td className="n">{s.returns[m] ? '−' + money(s.returns[m]) : '—'}</td><td className="n"><b>{money(s.net[m])}</b></td></tr>
          ))}
          <tr className="total-row"><td>Всего</td><td className="n">{money(s.salesSum)}</td><td className="n">{s.returnsSum ? '−' + money(s.returnsSum) : '—'}</td><td className="n"><b>{money(s.revenue)}</b></td></tr>
        </tbody>
      </table>

      <div className="kv">
        <div><span>Общая сумма продаж</span><b>{money(s.salesSum)}</b></div>
        <div><span>Количество продаж</span><b>{s.salesCount}</b></div>
        <div><span>Возвраты ({s.returnsCount})</span><b className={s.returnsSum ? 'red-text' : ''}>{money(s.returnsSum)}</b></div>
        <div><span>Отменено продаж ({s.cancelledCount})</span><b>{money(s.cancelledSum)}</b></div>
        {manager && (
          <>
            <div><span>Себестоимость проданного</span><b>{money(s.cogs)}</b></div>
            <div className="big"><span>Валовая прибыль</span><b className={s.profit < 0 ? 'red-text' : 'green-text'}>{money(s.profit)}</b></div>
            <div><span>Маржа</span><b>{s.revenue ? round2((s.profit / s.revenue) * 100) + '%' : '—'}</b></div>
            <div><span>Приход товара ({s.receiptCount})</span><b>{money(s.receiptSum)}</b></div>
            <div><span>Списания ({s.writeoffCount})</span><b>{money(s.writeoffSum)}</b></div>
            {s.auditCount > 0 && <div><span>Ревизии: недостача / излишки</span><b><span className="red-text">{money(s.auditShortage)}</span> / <span className="green-text">{money(s.auditSurplus)}</span></b></div>}
          </>
        )}
      </div>
    </div>
  )
}

function StockView() {
  const { products, categories } = useStore()
  const active = products.filter((p) => !p.archived)
  const byCat = new Map<string, { name: string; qty: number; cost: number; sale: number; count: number }>()
  for (const p of active) {
    const name = categories.find((c) => c.id === p.category_id)?.name ?? 'Без категории'
    const r = byCat.get(name) ?? { name, qty: 0, cost: 0, sale: 0, count: 0 }
    r.count++
    r.qty += Math.max(0, p.stock)
    r.cost += Math.max(0, p.stock) * p.purchase_price
    r.sale += Math.max(0, p.stock) * p.sale_price
    byCat.set(name, r)
  }
  const rows = [...byCat.values()].sort((a, b) => b.cost - a.cost)
  const tot = rows.reduce((t, r) => ({ cost: t.cost + r.cost, sale: t.sale + r.sale }), { cost: 0, sale: 0 })
  return (
    <>
      <div className="kv">
        <div><span>Товаров в базе</span><b>{active.length}</b></div>
        <div><span>Нет в наличии</span><b>{active.filter((p) => p.stock <= 0).length}</b></div>
        <div><span>Остаток по закупочной цене</span><b>{money(tot.cost)}</b></div>
        <div><span>Остаток по цене продажи</span><b>{money(tot.sale)}</b></div>
      </div>
      <table className="table">
        <thead><tr><th>Категория</th><th>Позиций</th><th>По закупке</th><th>По продаже</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td className="n">{r.count}</td><td className="n">{money(r.cost)}</td><td className="n">{money(r.sale)}</td></tr>)}</tbody>
      </table>
    </>
  )
}

function buildDoc(label: string, shopName: string, s: Summary, days: ReturnType<typeof byDay>, ops: Operation[],
  goods: ReturnType<typeof movement>, manager: boolean, products: ReturnType<typeof useStore>['products'],
  categories: ReturnType<typeof useStore>['categories']): ReportDoc {
  const summary: (string | number)[][] = [
    ['Выручка (продажи − возвраты)', s.revenue],
    ['Общая сумма продаж', s.salesSum],
    ['Количество продаж', s.salesCount],
    ['Средний чек', s.avgCheck],
    ['Наличные (итого)', s.net.cash],
    ['Kaspi (итого)', s.net.kaspi],
    ['Другие банки (итого)', s.net.bank],
    ...Object.entries(s.net.banks).map(([k, v]) => ['   ' + k, v] as [string, number]),
    ['Возвраты', s.returnsSum],
    ['Количество возвратов', s.returnsCount],
    ['Отменено продаж', s.cancelledCount],
  ]
  if (manager) {
    summary.push(['Себестоимость проданного', s.cogs], ['Валовая прибыль', s.profit], ['Приход товара (закупка)', s.receiptSum],
      ['Списания', s.writeoffSum], ['Недостача по ревизиям', s.auditShortage], ['Излишки по ревизиям', s.auditSurplus])
  }
  const doc: ReportDoc = {
    title: `Отчёт — ${label}`,
    subtitle: shopName,
    sections: [
      { title: 'Сводка', rows: summary },
      {
        title: 'Движение денег',
        head: ['Способ оплаты', 'Продажи', 'Возвраты', 'Итого'],
        rows: [
          ...(['cash', 'kaspi', 'bank'] as const).map((m) => [PAY_LABEL[m], s.sales[m], s.returns[m], s.net[m]]),
          ['Всего', s.salesSum, s.returnsSum, s.revenue],
        ],
        money: [1, 2, 3],
      },
      {
        title: 'По дням',
        head: ['День', 'Продаж', 'Продажи', 'Наличные', 'Kaspi', 'Банки', 'Возвраты', 'Выручка', ...(manager ? ['Прибыль'] : [])],
        rows: days.map((d) => [dateOnly(d.day + 'T00:00:00'), d.salesCount, d.sales, d.cash, d.kaspi, d.bank, d.returns, d.revenue, ...(manager ? [d.profit] : [])]),
        money: [2, 3, 4, 5, 6, 7, 8],
      },
      {
        title: 'Операции',
        head: ['№', 'Дата и время', 'Операция', 'Статус', 'Сотрудник', 'Сумма', 'Наличные', 'Kaspi', 'Банк', 'Название банка', 'Товары'],
        rows: ops.map((o) => {
          const by = (m: string) => round2(o.payments.filter((p) => p.method === m).reduce((a, p) => a + p.amount, 0)) || ''
          return [o.number, dateTime(o.created_at), OP_LABEL[o.type], o.status === 'cancelled' ? 'отменена' : '', o.user_name ?? '', o.total,
            by('cash'), by('kaspi'), by('bank'), o.payments.filter((p) => p.bank_name).map((p) => p.bank_name).join(', '),
            o.items.map((i) => `${i.product_name} × ${i.qty}`).join('; ')]
        }),
        money: [5, 6, 7, 8],
      },
    ],
  }
  if (manager) {
    doc.sections.push({
      title: 'Движение товаров',
      head: ['Товар', 'Ед.', 'Остаток на начало', 'Приход', 'Продано', 'Возвраты', 'Отмены', 'Списано', 'Ревизия ±', 'Остаток на конец', 'Сумма продаж'],
      rows: goods.map((g) => [g.name, g.unit, g.start, g.receipt, g.sold, g.returned, g.cancelled, g.writeoff, g.audit, g.end, g.soldSum]),
      money: [10],
    })
    const cat = new Map(categories.map((c) => [c.id, c.name]))
    doc.sections.push({
      title: 'Остатки товаров',
      head: ['Товар', 'Штрихкод', 'Категория', 'Ед.', 'Остаток', 'Закуп. цена', 'Цена продажи', 'Сумма по закупке', 'Сумма по продаже'],
      rows: products.filter((p) => !p.archived).map((p) => [p.name, p.barcode ?? '', cat.get(p.category_id ?? '') ?? '', p.unit, p.stock,
        p.purchase_price, p.sale_price, round2(p.stock * p.purchase_price), round2(p.stock * p.sale_price)]),
      money: [5, 6, 7, 8],
    })
  }
  return doc
}
