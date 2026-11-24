export type Role = 'owner' | 'manager' | 'cashier' | 'pending' | 'blocked'

export interface Profile {
  id: string
  email: string
  name: string
  role: Role
  created_at: string
}

export interface Category {
  id: string
  name: string
}

export interface Bank {
  id: string
  name: string
}

export interface Product {
  id: string
  name: string
  barcode: string | null
  category_id: string | null
  purchase_price: number
  sale_price: number
  stock: number
  unit: string
  archived: boolean
  created_at: string
  updated_at: string
}

export type ProductDraft = Omit<Product, 'id' | 'stock' | 'created_at' | 'updated_at' | 'archived'> & {
  id?: string
  archived?: boolean
}

/** sale — продажа, receipt — приход, writeoff — списание, return — возврат,
 *  audit — ревизия, cancel — отмена продажи */
export type OpType = 'sale' | 'receipt' | 'writeoff' | 'return' | 'audit' | 'cancel'
export type PostableOpType = Exclude<OpType, 'cancel'>

export type PayMethod = 'cash' | 'kaspi' | 'bank'

export interface Payment {
  method: PayMethod
  bank_name?: string | null
  amount: number
}

export interface OpItem {
  product_id: string
  product_name: string
  /** Количество в операции (всегда положительное, для ревизии — модуль разницы) */
  qty: number
  /** Изменение остатка: + приход/возврат/излишек, − продажа/списание/недостача */
  delta: number
  /** Цена: продажи (sale/return/audit) или закупки (receipt/writeoff) */
  price: number
  /** Закупочная цена (себестоимость) на момент операции */
  cost: number
  expected_qty?: number | null
  actual_qty?: number | null
}

export interface Operation {
  id: string
  number: number
  type: OpType
  status: 'done' | 'cancelled'
  created_at: string
  user_id: string | null
  user_name: string | null
  /** Сумма операции: продажи / возврата / закупки / списания (по себестоимости) / ревизии (разница по себестоимости) */
  total: number
  cost_total: number
  comment: string | null
  reason: string | null
  supplier: string | null
  ref_id: string | null
  items: OpItem[]
  payments: Payment[]
}

export interface OperationInputItem {
  product_id: string
  qty?: number
  price?: number
  expected_qty?: number
  actual_qty?: number
  /** Для прихода: новая цена продажи */
  new_sale_price?: number
}

export interface OperationInput {
  type: PostableOpType
  items: OperationInputItem[]
  payments?: Payment[]
  comment?: string | null
  reason?: string | null
  supplier?: string | null
  ref_id?: string | null
}

export interface OperationQuery {
  from?: string
  to?: string
  types?: OpType[]
  limit?: number
}

export interface ProductMovement {
  op: Pick<Operation, 'id' | 'number' | 'type' | 'status' | 'created_at' | 'user_name' | 'reason'>
  item: OpItem
}

export interface BackupData {
  version: 1
  created_at: string
  settings: Record<string, unknown>
  categories: Category[]
  banks: Bank[]
  products: Product[]
  operations: Operation[]
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Владелец',
  manager: 'Менеджер',
  cashier: 'Кассир',
  pending: 'Ожидает подтверждения',
  blocked: 'Заблокирован',
}

export const OP_LABEL: Record<OpType, string> = {
  sale: 'Продажа',
  receipt: 'Приход',
  writeoff: 'Списание',
  return: 'Возврат',
  audit: 'Ревизия',
  cancel: 'Отмена продажи',
}

export const OP_ICON: Record<OpType, string> = {
  sale: '🛒',
  receipt: '📦',
  writeoff: '🗑️',
  return: '↩️',
  audit: '📋',
  cancel: '❌',
}

export const PAY_LABEL: Record<PayMethod, string> = {
  cash: 'Наличные',
  kaspi: 'Kaspi',
  bank: 'Другой банк',
}

export const WRITEOFF_REASONS: Record<string, string> = {
  spoiled: 'Испорчен / брак',
  expired: 'Истёк срок годности',
  lost: 'Утерян / кража',
  other: 'Другое',
}

export const UNITS = ['шт', 'кг', 'г', 'л', 'м', 'уп', 'пачка', 'бут']

export function canManage(role: Role | undefined) {
  return role === 'owner' || role === 'manager'
}
export function isStaff(role: Role | undefined) {
  return role === 'owner' || role === 'manager' || role === 'cashier'
}
