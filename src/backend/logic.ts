import { round2, round3 } from '../lib/format'
import type { OpItem, Operation, OperationInput, Payment, Product, Role } from '../lib/types'

/**
 * Единые правила проведения операций. В облачном режиме те же правила
 * выполняет функция post_operation в базе данных (supabase/schema.sql),
 * этот модуль используется в локальном режиме и для проверки перед отправкой.
 */

export class OpError extends Error {}

export function checkRights(type: OperationInput['type'] | 'cancel', role: Role) {
  if (!['owner', 'manager', 'cashier'].includes(role)) throw new OpError('Нет доступа')
  if ((type === 'receipt' || type === 'writeoff' || type === 'audit' || type === 'cancel') && role === 'cashier') {
    throw new OpError('Недостаточно прав для этой операции')
  }
}

export function validatePayments(payments: Payment[] | undefined, total: number) {
  const list = payments ?? []
  if (list.length === 0) throw new OpError('Укажите способ оплаты')
  let sum = 0
  for (const p of list) {
    if (!['cash', 'kaspi', 'bank'].includes(p.method)) throw new OpError('Неверный способ оплаты')
    if (!(p.amount > 0)) throw new OpError('Сумма оплаты должна быть больше нуля')
    if (p.method === 'bank' && !p.bank_name?.trim()) throw new OpError('Укажите банк')
    sum += p.amount
  }
  if (Math.abs(round2(sum) - round2(total)) > 0.009) {
    throw new OpError(`Сумма оплаты (${round2(sum)}) не совпадает с суммой (${round2(total)})`)
  }
}

export interface BuiltOperation {
  op: Operation
  /** изменения товаров: id → новые поля */
  productUpdates: Map<string, Partial<Product>>
}

export function buildOperation(
  input: OperationInput,
  products: Map<string, Product>,
  ctx: { id: string; number: number; userId: string | null; userName: string | null; role: Role; now: string },
): BuiltOperation {
  checkRights(input.type, ctx.role)
  if (!input.items?.length) throw new OpError('Нет товаров в операции')

  const updates = new Map<string, Partial<Product>>()
  const items: OpItem[] = []
  let total = 0
  let costTotal = 0

  for (const it of input.items) {
    const base = products.get(it.product_id)
    if (!base) throw new OpError('Товар не найден')
    const p = { ...base, ...updates.get(base.id) }
    let qty: number, delta: number, price: number
    let expected: number | null = null
    let actual: number | null = null
    const cost = input.type === 'receipt' ? (it.price ?? p.purchase_price) : p.purchase_price

    if (input.type === 'audit') {
      expected = round3(it.expected_qty ?? p.stock)
      actual = it.actual_qty ?? NaN
      if (!(actual >= 0)) throw new OpError(`Неверное фактическое количество: ${p.name}`)
      actual = round3(actual)
      delta = round3(actual - expected)
      qty = Math.abs(delta)
      price = p.sale_price
      total += delta * cost
      costTotal += delta * cost
    } else {
      qty = round3(it.qty ?? 0)
      if (!(qty > 0)) throw new OpError(`Неверное количество: ${p.name}`)
      price = it.price ?? (input.type === 'receipt' || input.type === 'writeoff' ? p.purchase_price : p.sale_price)
      if (!(price >= 0)) throw new OpError(`Неверная цена: ${p.name}`)
      price = round2(price)
      delta = input.type === 'sale' || input.type === 'writeoff' ? -qty : qty
      total += qty * price
      costTotal += qty * cost
    }

    items.push({ product_id: p.id, product_name: p.name, qty, delta, price, cost: round2(cost), expected_qty: expected, actual_qty: actual })

    const upd: Partial<Product> = { ...updates.get(p.id), stock: round3(p.stock + delta), updated_at: ctx.now }
    if (input.type === 'receipt') {
      upd.purchase_price = price
      if (it.new_sale_price != null && it.new_sale_price >= 0) upd.sale_price = round2(it.new_sale_price)
    }
    updates.set(p.id, upd)
  }

  total = round2(total)
  costTotal = round2(costTotal)

  let payments: Payment[] = []
  if (input.type === 'sale' || input.type === 'return') {
    validatePayments(input.payments, total)
    payments = (input.payments ?? []).map((p) => ({
      method: p.method,
      bank_name: p.method === 'bank' ? p.bank_name!.trim() : null,
      amount: round2(p.amount),
    }))
  }

  const op: Operation = {
    id: ctx.id,
    number: ctx.number,
    type: input.type,
    status: 'done',
    created_at: ctx.now,
    user_id: ctx.userId,
    user_name: ctx.userName,
    total,
    cost_total: costTotal,
    comment: input.comment?.trim() || null,
    reason: input.reason || null,
    supplier: input.supplier?.trim() || null,
    ref_id: input.ref_id || null,
    items,
    payments,
  }
  return { op, productUpdates: updates }
}

/** Сколько единиц каждого товара уже возвращено по продаже */
export function returnedQty(linked: Operation[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const op of linked) {
    if (op.type !== 'return' || op.status !== 'done') continue
    for (const it of op.items) m.set(it.product_id, (m.get(it.product_id) ?? 0) + it.qty)
  }
  return m
}
