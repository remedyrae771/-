import { get, set } from 'idb-keyval'
import { round3, uid } from '../lib/format'
import type {
  BackupData, Bank, Category, Operation, OperationInput, OperationQuery, Product, ProductDraft, ProductMovement, Profile,
} from '../lib/types'
import { buildOperation, OpError, returnedQty } from './logic'
import type { Backend } from './types'

/**
 * Локальный режим: все данные хранятся только на этом телефоне (IndexedDB).
 * Подходит для знакомства с приложением и для работы с одного устройства.
 */

interface LocalDb {
  counter: number
  settings: Record<string, unknown>
  categories: Category[]
  banks: Bank[]
  products: Product[]
  operations: Operation[]
}

const KEY = 'shop-local-db-v1'

const LOCAL_USER: Profile = {
  id: 'local-owner',
  email: '',
  name: 'Владелец',
  role: 'owner',
  created_at: new Date(0).toISOString(),
}

export const DEFAULT_BANKS = ['Halyk Bank', 'Freedom Bank', 'Forte Bank', 'Jusan Bank', 'Bank CenterCredit', 'Home Credit Bank', 'Евразийский банк']

function emptyDb(): LocalDb {
  return {
    counter: 0,
    settings: { shop_name: 'Мой магазин' },
    categories: [],
    banks: DEFAULT_BANKS.map((name) => ({ id: uid(), name })),
    products: [],
    operations: [],
  }
}

export class LocalBackend implements Backend {
  mode = 'local' as const
  private db: LocalDb | null = null
  private listeners = new Set<(p: Product) => void>()
  private queue: Promise<unknown> = Promise.resolve()

  private async load(): Promise<LocalDb> {
    if (!this.db) this.db = ((await get(KEY)) as LocalDb | undefined) ?? emptyDb()
    return this.db
  }

  private async save() {
    if (this.db) await set(KEY, this.db)
  }

  /** Последовательное выполнение изменяющих операций */
  private tx<T>(fn: (db: LocalDb) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const db = await this.load()
      const snapshot = structuredClone(db)
      try {
        const r = await fn(db)
        await this.save()
        return r
      } catch (e) {
        this.db = snapshot
        throw e
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  async currentProfile() { return LOCAL_USER }
  async signIn() {}
  async signUp() {}
  async signOut() {}
  onAuthChange() { return () => {} }

  async listProducts() { return structuredClone((await this.load()).products) }

  saveProduct(d: ProductDraft) {
    return this.tx((db) => {
      const name = d.name.trim()
      if (!name) throw new OpError('Укажите название')
      const barcode = d.barcode?.trim() || null
      if (barcode && db.products.some((p) => p.barcode === barcode && p.id !== d.id)) {
        throw new OpError('Товар с таким штрихкодом уже есть в базе')
      }
      const now = new Date().toISOString()
      let p = d.id ? db.products.find((x) => x.id === d.id) : undefined
      if (p) {
        Object.assign(p, {
          name, barcode, category_id: d.category_id, purchase_price: d.purchase_price, sale_price: d.sale_price,
          unit: d.unit, archived: d.archived ?? p.archived, updated_at: now,
        })
      } else {
        p = {
          id: uid(), name, barcode, category_id: d.category_id, purchase_price: d.purchase_price, sale_price: d.sale_price,
          unit: d.unit || 'шт', stock: 0, archived: false, created_at: now, updated_at: now,
        }
        db.products.push(p)
      }
      const copy = structuredClone(p)
      this.emit(copy)
      return copy
    })
  }

  setProductArchived(id: string, archived: boolean) {
    return this.tx((db) => {
      const p = db.products.find((x) => x.id === id)
      if (p) {
        p.archived = archived
        p.updated_at = new Date().toISOString()
        this.emit(structuredClone(p))
      }
    })
  }

  async listCategories() { return structuredClone((await this.load()).categories).sort((a, b) => a.name.localeCompare(b.name)) }

  saveCategory(c: { id?: string; name: string }) {
    return this.tx((db) => {
      const name = c.name.trim()
      if (!name) throw new OpError('Укажите название категории')
      let cat = c.id ? db.categories.find((x) => x.id === c.id) : undefined
      if (cat) cat.name = name
      else {
        cat = { id: uid(), name }
        db.categories.push(cat)
      }
      return { ...cat }
    })
  }

  deleteCategory(id: string) {
    return this.tx((db) => {
      db.categories = db.categories.filter((c) => c.id !== id)
      for (const p of db.products) if (p.category_id === id) p.category_id = null
    })
  }

  async listBanks() { return structuredClone((await this.load()).banks) }

  saveBank(b: { id?: string; name: string }) {
    return this.tx((db) => {
      const name = b.name.trim()
      if (!name) throw new OpError('Укажите название банка')
      let bank = b.id ? db.banks.find((x) => x.id === b.id) : undefined
      if (bank) bank.name = name
      else {
        bank = { id: uid(), name }
        db.banks.push(bank)
      }
      return { ...bank }
    })
  }

  deleteBank(id: string) {
    return this.tx((db) => { db.banks = db.banks.filter((b) => b.id !== id) })
  }

  async getSettings() { return { ...(await this.load()).settings } }
  setSetting(key: string, value: unknown) { return this.tx((db) => { db.settings[key] = value }) }

  subscribeProducts(cb: (p: Product) => void) {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  private emit(p: Product) { for (const l of this.listeners) l(p) }

  postOperation(input: OperationInput) {
    return this.tx((db) => {
      const products = new Map(db.products.map((p) => [p.id, p]))
      if (input.type === 'return' && input.ref_id) {
        const sale = db.operations.find((o) => o.id === input.ref_id)
        if (!sale || sale.type !== 'sale') throw new OpError('Продажа не найдена')
        if (sale.status !== 'done') throw new OpError('Продажа отменена')
        checkReturnLimits(input, sale, db.operations.filter((o) => o.ref_id === sale.id))
      }
      const { op, productUpdates } = buildOperation(input, products, {
        id: uid(), number: db.counter + 1, userId: LOCAL_USER.id, userName: LOCAL_USER.name, role: LOCAL_USER.role,
        now: new Date().toISOString(),
      })
      db.counter += 1
      db.operations.push(op)
      for (const [id, upd] of productUpdates) {
        const p = products.get(id)!
        Object.assign(p, upd)
        this.emit(structuredClone(p))
      }
      return structuredClone(op)
    })
  }

  cancelSale(id: string, reason: string) {
    return this.tx((db) => {
      const sale = db.operations.find((o) => o.id === id)
      if (!sale || sale.type !== 'sale') throw new OpError('Продажа не найдена')
      if (sale.status !== 'done') throw new OpError('Продажа уже отменена')
      if (db.operations.some((o) => o.ref_id === id && o.type === 'return' && o.status === 'done')) {
        throw new OpError('По этой продаже уже был возврат — отмена невозможна')
      }
      const now = new Date().toISOString()
      const op: Operation = {
        id: uid(), number: db.counter + 1, type: 'cancel', status: 'done', created_at: now,
        user_id: LOCAL_USER.id, user_name: LOCAL_USER.name, total: sale.total, cost_total: sale.cost_total,
        comment: reason?.trim() || null, reason: null, supplier: null, ref_id: sale.id,
        items: sale.items.map((it) => ({ ...it, delta: it.qty })), payments: [],
      }
      db.counter += 1
      sale.status = 'cancelled'
      db.operations.push(op)
      for (const it of sale.items) {
        const p = db.products.find((x) => x.id === it.product_id)
        if (p) {
          p.stock = round3(p.stock + it.qty)
          p.updated_at = now
          this.emit(structuredClone(p))
        }
      }
      return structuredClone(op)
    })
  }

  async listOperations(q: OperationQuery) {
    const db = await this.load()
    let list = db.operations.filter((o) =>
      (!q.from || o.created_at >= q.from) && (!q.to || o.created_at < q.to) && (!q.types || q.types.includes(o.type)))
    list = list.sort((a, b) => b.created_at.localeCompare(a.created_at))
    if (q.limit) list = list.slice(0, q.limit)
    return structuredClone(list)
  }

  async getOperation(id: string) {
    const op = (await this.load()).operations.find((o) => o.id === id)
    return op ? structuredClone(op) : null
  }

  async listLinkedOperations(id: string) {
    return structuredClone((await this.load()).operations.filter((o) => o.ref_id === id))
  }

  async productHistory(productId: string): Promise<ProductMovement[]> {
    const db = await this.load()
    const res: ProductMovement[] = []
    for (const o of db.operations) {
      for (const it of o.items) {
        if (it.product_id === productId) {
          res.push({ op: { id: o.id, number: o.number, type: o.type, status: o.status, created_at: o.created_at, user_name: o.user_name, reason: o.reason }, item: { ...it } })
        }
      }
    }
    return res.sort((a, b) => b.op.created_at.localeCompare(a.op.created_at))
  }

  async listStaff() { return [LOCAL_USER] }
  async setStaffRole() { throw new OpError('Сотрудники доступны только в облачном режиме') }
  async setStaffName() { throw new OpError('Сотрудники доступны только в облачном режиме') }

  async exportBackup(): Promise<BackupData> {
    const db = await this.load()
    return {
      version: 1, created_at: new Date().toISOString(), settings: db.settings,
      categories: db.categories, banks: db.banks, products: db.products, operations: db.operations,
    }
  }

  importBackup(data: BackupData) {
    return this.tx((db) => {
      if (data?.version !== 1 || !Array.isArray(data.products)) throw new OpError('Неверный файл резервной копии')
      db.settings = data.settings ?? {}
      db.categories = data.categories ?? []
      db.banks = data.banks ?? []
      db.products = data.products
      db.operations = data.operations ?? []
      db.counter = db.operations.reduce((m, o) => Math.max(m, o.number), 0)
      for (const p of db.products) this.emit(structuredClone(p))
    })
  }
}

export function checkReturnLimits(input: OperationInput, sale: Operation, linked: Operation[]) {
  const returned = returnedQty(linked)
  const sold = new Map<string, number>()
  for (const it of sale.items) sold.set(it.product_id, (sold.get(it.product_id) ?? 0) + it.qty)
  const want = new Map<string, number>()
  for (const it of input.items) want.set(it.product_id, (want.get(it.product_id) ?? 0) + (it.qty ?? 0))
  for (const [pid, q] of want) {
    const left = (sold.get(pid) ?? 0) - (returned.get(pid) ?? 0)
    if (q > left + 1e-9) throw new OpError('Количество возврата больше, чем было продано')
  }
}
