import { dayKey, round2, round3 } from './format'
import type { Operation, Product } from './types'

export interface MethodTotals {
  cash: number
  kaspi: number
  bank: number
  banks: Record<string, number>
}

const emptyMethods = (): MethodTotals => ({ cash: 0, kaspi: 0, bank: 0, banks: {} })

function addPayments(t: MethodTotals, op: Operation) {
  for (const p of op.payments) {
    t[p.method] = round2(t[p.method] + p.amount)
    if (p.method === 'bank') {
      const k = p.bank_name || 'Банк'
      t.banks[k] = round2((t.banks[k] ?? 0) + p.amount)
    }
  }
}

export interface Summary {
  salesCount: number
  salesSum: number
  salesCost: number
  sales: MethodTotals
  returnsCount: number
  returnsSum: number
  returnsCost: number
  returns: MethodTotals
  /** Деньги за период по способам: продажи минус возвраты */
  net: MethodTotals
  /** Выручка = продажи − возвраты */
  revenue: number
  /** Себестоимость проданного (с учётом возвратов) */
  cogs: number
  profit: number
  avgCheck: number
  itemsSold: number
  cancelledCount: number
  cancelledSum: number
  writeoffCount: number
  writeoffSum: number
  receiptCount: number
  receiptSum: number
  auditCount: number
  auditShortage: number
  auditSurplus: number
}

export function summarize(ops: Operation[]): Summary {
  const s: Summary = {
    salesCount: 0, salesSum: 0, salesCost: 0, sales: emptyMethods(),
    returnsCount: 0, returnsSum: 0, returnsCost: 0, returns: emptyMethods(), net: emptyMethods(),
    revenue: 0, cogs: 0, profit: 0, avgCheck: 0, itemsSold: 0,
    cancelledCount: 0, cancelledSum: 0, writeoffCount: 0, writeoffSum: 0, receiptCount: 0, receiptSum: 0,
    auditCount: 0, auditShortage: 0, auditSurplus: 0,
  }
  for (const op of ops) {
    switch (op.type) {
      case 'sale':
        if (op.status === 'cancelled') {
          s.cancelledCount++
          s.cancelledSum += op.total
          break
        }
        s.salesCount++
        s.salesSum += op.total
        s.salesCost += op.cost_total
        s.itemsSold += op.items.reduce((a, i) => a + i.qty, 0)
        addPayments(s.sales, op)
        break
      case 'return':
        if (op.status !== 'done') break
        s.returnsCount++
        s.returnsSum += op.total
        s.returnsCost += op.cost_total
        addPayments(s.returns, op)
        break
      case 'writeoff':
        s.writeoffCount++
        s.writeoffSum += op.total
        break
      case 'receipt':
        s.receiptCount++
        s.receiptSum += op.total
        break
      case 'audit':
        s.auditCount++
        for (const it of op.items) {
          const v = it.delta * it.cost
          if (v < 0) s.auditShortage += -v
          else s.auditSurplus += v
        }
        break
    }
  }
  const r = round2
  s.salesSum = r(s.salesSum); s.salesCost = r(s.salesCost); s.returnsSum = r(s.returnsSum); s.returnsCost = r(s.returnsCost)
  s.cancelledSum = r(s.cancelledSum); s.writeoffSum = r(s.writeoffSum); s.receiptSum = r(s.receiptSum)
  s.auditShortage = r(s.auditShortage); s.auditSurplus = r(s.auditSurplus); s.itemsSold = round3(s.itemsSold)
  s.revenue = r(s.salesSum - s.returnsSum)
  s.cogs = r(s.salesCost - s.returnsCost)
  s.profit = r(s.revenue - s.cogs)
  s.avgCheck = s.salesCount ? r(s.salesSum / s.salesCount) : 0
  for (const m of ['cash', 'kaspi', 'bank'] as const) s.net[m] = r(s.sales[m] - s.returns[m])
  for (const k of new Set([...Object.keys(s.sales.banks), ...Object.keys(s.returns.banks)])) {
    s.net.banks[k] = r((s.sales.banks[k] ?? 0) - (s.returns.banks[k] ?? 0))
  }
  return s
}

export interface DayRow {
  day: string
  salesCount: number
  sales: number
  cash: number
  kaspi: number
  bank: number
  returns: number
  revenue: number
  profit: number
}

export function byDay(ops: Operation[]): DayRow[] {
  const groups = new Map<string, Operation[]>()
  for (const op of ops) {
    const k = dayKey(op.created_at)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(op)
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, list]) => {
      const s = summarize(list)
      return {
        day, salesCount: s.salesCount, sales: s.salesSum, cash: s.net.cash, kaspi: s.net.kaspi, bank: s.net.bank,
        returns: s.returnsSum, revenue: s.revenue, profit: s.profit,
      }
    })
    .filter((r) => r.salesCount > 0 || r.returns > 0)
}

export interface MovementRow {
  product_id: string
  name: string
  unit: string
  start: number
  receipt: number
  sold: number
  returned: number
  cancelled: number
  writeoff: number
  audit: number
  end: number
  soldSum: number
}

/**
 * Движение товаров за период.
 * opsInPeriod — операции периода; opsAfter — операции после конца периода (для расчёта остатка на конец).
 * Учёт ведётся «по журналу»: начало + все движения = конец.
 */
export function movement(products: Product[], opsInPeriod: Operation[], opsAfter: Operation[]): MovementRow[] {
  const rows = new Map<string, MovementRow>()
  const after = new Map<string, number>()
  for (const op of opsAfter) for (const it of op.items) after.set(it.product_id, (after.get(it.product_id) ?? 0) + it.delta)

  const get = (id: string, name: string) => {
    let r = rows.get(id)
    if (!r) {
      const p = products.find((x) => x.id === id)
      r = { product_id: id, name: p?.name ?? name, unit: p?.unit ?? '', start: 0, receipt: 0, sold: 0, returned: 0, cancelled: 0, writeoff: 0, audit: 0, end: 0, soldSum: 0 }
      rows.set(id, r)
    }
    return r
  }

  for (const op of opsInPeriod) {
    for (const it of op.items) {
      const r = get(it.product_id, it.product_name)
      switch (op.type) {
        case 'receipt': r.receipt += it.qty; break
        case 'sale': r.sold += it.qty; if (op.status === 'done') r.soldSum += it.qty * it.price; break
        case 'return': r.returned += it.qty; break
        case 'cancel': r.cancelled += it.qty; break
        case 'writeoff': r.writeoff += it.qty; break
        case 'audit': r.audit += it.delta; break
      }
    }
  }
  const prod = new Map(products.map((p) => [p.id, p]))
  for (const r of rows.values()) {
    const current = prod.get(r.product_id)?.stock ?? 0
    r.end = round3(current - (after.get(r.product_id) ?? 0))
    r.start = round3(r.end - r.receipt + r.sold - r.returned - r.cancelled + r.writeoff - r.audit)
    r.soldSum = round2(r.soldSum)
    for (const k of ['receipt', 'sold', 'returned', 'cancelled', 'writeoff', 'audit'] as const) r[k] = round3(r[k])
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

export interface AuditTotals {
  checked: number
  shortageQty: number
  surplusQty: number
  shortageCost: number
  surplusCost: number
  shortageSale: number
  surplusSale: number
}

export function auditTotals(op: Pick<Operation, 'items'>): AuditTotals {
  const t: AuditTotals = { checked: op.items.length, shortageQty: 0, surplusQty: 0, shortageCost: 0, surplusCost: 0, shortageSale: 0, surplusSale: 0 }
  for (const it of op.items) {
    if (it.delta < 0) {
      t.shortageQty += -it.delta
      t.shortageCost += -it.delta * it.cost
      t.shortageSale += -it.delta * it.price
    } else if (it.delta > 0) {
      t.surplusQty += it.delta
      t.surplusCost += it.delta * it.cost
      t.surplusSale += it.delta * it.price
    }
  }
  t.shortageQty = round3(t.shortageQty); t.surplusQty = round3(t.surplusQty)
  t.shortageCost = round2(t.shortageCost); t.surplusCost = round2(t.surplusCost)
  t.shortageSale = round2(t.shortageSale); t.surplusSale = round2(t.surplusSale)
  return t
}
