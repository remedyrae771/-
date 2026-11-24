import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  BackupData, Bank, Category, OpItem, Operation, OperationInput, OperationQuery, Payment, Product, ProductDraft, ProductMovement,
  Profile, Role,
} from '../lib/types'
import { OpError } from './logic'
import type { Backend } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const n = (v: unknown) => (v == null ? 0 : Number(v))
const nn = (v: unknown) => (v == null ? null : Number(v))

function mapProduct(r: any): Product {
  return {
    id: r.id, name: r.name, barcode: r.barcode, category_id: r.category_id,
    purchase_price: n(r.purchase_price), sale_price: n(r.sale_price), stock: n(r.stock), unit: r.unit || 'шт',
    archived: !!r.archived, created_at: r.created_at, updated_at: r.updated_at,
  }
}

function mapItem(r: any): OpItem {
  return {
    product_id: r.product_id, product_name: r.product_name, qty: n(r.qty), delta: n(r.delta), price: n(r.price),
    cost: n(r.cost), expected_qty: nn(r.expected_qty), actual_qty: nn(r.actual_qty),
  }
}

function mapPayment(r: any): Payment {
  return { method: r.method, bank_name: r.bank_name, amount: n(r.amount) }
}

function mapOp(r: any): Operation {
  return {
    id: r.id, number: n(r.number), type: r.type, status: r.status, created_at: r.created_at, user_id: r.user_id,
    user_name: r.user_name, total: n(r.total), cost_total: n(r.cost_total), comment: r.comment, reason: r.reason,
    supplier: r.supplier, ref_id: r.ref_id,
    items: (r.items ?? []).sort((a: any, b: any) => a.id - b.id).map(mapItem),
    payments: (r.payments ?? []).sort((a: any, b: any) => a.id - b.id).map(mapPayment),
  }
}

function check<R extends { data: any; error: any }>(res: R): NonNullable<R["data"]> {
  if (res.error) throw new OpError(translateError(res.error.message || String(res.error)))
  return res.data
}

function translateError(msg: string): string {
  if (/duplicate key.*barcode/i.test(msg)) return 'Товар с таким штрихкодом уже есть в базе'
  if (/duplicate key.*name/i.test(msg)) return 'Такое название уже существует'
  if (/row-level security/i.test(msg)) return 'Недостаточно прав'
  if (/Invalid login credentials/i.test(msg)) return 'Неверный email или пароль'
  if (/Email not confirmed/i.test(msg)) return 'Email не подтверждён — откройте письмо и перейдите по ссылке'
  if (/User already registered/i.test(msg)) return 'Этот email уже зарегистрирован'
  if (/Password should be at least/i.test(msg)) return 'Пароль должен быть не короче 6 символов'
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Нет связи с сервером. Проверьте интернет.'
  if (/violates foreign key.*operation_items/i.test(msg)) return 'Нельзя удалить: есть операции с этим элементом'
  return msg
}

const OP_SELECT = '*, items:operation_items(*), payments(*)'
const PAGE = 1000

export class SupabaseBackend implements Backend {
  mode = 'cloud' as const
  sb: SupabaseClient

  constructor(url: string, key: string) {
    this.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  }

  async currentProfile(): Promise<Profile | null> {
    const { data } = await this.sb.auth.getSession()
    const user = data.session?.user
    if (!user) return null
    const res = await this.sb.from('profiles').select('*').eq('id', user.id).maybeSingle()
    const p = check(res)
    if (!p) return { id: user.id, email: user.email ?? '', name: user.email ?? '', role: 'pending', created_at: user.created_at }
    return p as Profile
  }

  async signIn(email: string, password: string) {
    check(await this.sb.auth.signInWithPassword({ email: email.trim(), password }))
  }

  async signUp(email: string, password: string, name: string) {
    const res = check(await this.sb.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } }))
    if (!res.session) {
      throw new OpError('Регистрация прошла успешно. Подтвердите email по ссылке из письма, затем войдите.')
    }
  }

  async signOut() { await this.sb.auth.signOut() }

  onAuthChange(cb: () => void) {
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') cb()
    })
    return () => data.subscription.unsubscribe()
  }

  private async fetchAll(build: (from: number, to: number) => PromiseLike<{ data: any; error: any }>): Promise<any[]> {
    const out: any[] = []
    for (let from = 0; ; from += PAGE) {
      const rows = check(await build(from, from + PAGE - 1)) as any[]
      out.push(...rows)
      if (rows.length < PAGE) break
    }
    return out
  }

  async listProducts() {
    const rows = await this.fetchAll((a, b) => this.sb.from('products').select('*').order('name').range(a, b))
    return rows.map(mapProduct)
  }

  async saveProduct(d: ProductDraft) {
    const row = {
      name: d.name.trim(), barcode: d.barcode?.trim() || null, category_id: d.category_id || null,
      purchase_price: d.purchase_price, sale_price: d.sale_price, unit: d.unit || 'шт',
      ...(d.archived != null ? { archived: d.archived } : {}),
    }
    if (!row.name) throw new OpError('Укажите название')
    const res = d.id
      ? await this.sb.from('products').update(row).eq('id', d.id).select().single()
      : await this.sb.from('products').insert(row).select().single()
    return mapProduct(check(res))
  }

  async setProductArchived(id: string, archived: boolean) {
    check(await this.sb.from('products').update({ archived }).eq('id', id))
    await this.refreshProducts([id])
  }

  async listCategories() { return check(await this.sb.from('categories').select('id,name').order('name')) as Category[] }

  async saveCategory(c: { id?: string; name: string }) {
    const name = c.name.trim()
    if (!name) throw new OpError('Укажите название категории')
    const res = c.id
      ? await this.sb.from('categories').update({ name }).eq('id', c.id).select('id,name').single()
      : await this.sb.from('categories').insert({ name }).select('id,name').single()
    return check(res) as Category
  }

  async deleteCategory(id: string) { check(await this.sb.from('categories').delete().eq('id', id)) }

  async listBanks() { return check(await this.sb.from('banks').select('id,name').order('created_at')) as Bank[] }

  async saveBank(b: { id?: string; name: string }) {
    const name = b.name.trim()
    if (!name) throw new OpError('Укажите название банка')
    const res = b.id
      ? await this.sb.from('banks').update({ name }).eq('id', b.id).select('id,name').single()
      : await this.sb.from('banks').insert({ name }).select('id,name').single()
    return check(res) as Bank
  }

  async deleteBank(id: string) { check(await this.sb.from('banks').delete().eq('id', id)) }

  async getSettings() {
    const rows = check(await this.sb.from('settings').select('*')) as { key: string; value: unknown }[]
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  }

  async setSetting(key: string, value: unknown) {
    check(await this.sb.from('settings').upsert({ key, value }))
  }

  private listeners = new Set<(p: Product) => void>()

  /** Перечитать товары после операции и сообщить подписчикам (не ждём realtime) */
  private async refreshProducts(ids: string[]) {
    if (!ids.length) return
    try {
      const rows = check(await this.sb.from('products').select('*').in('id', [...new Set(ids)])) as any[]
      for (const r of rows) for (const l of this.listeners) l(mapProduct(r))
    } catch { /* обновится при следующей загрузке */ }
  }

  subscribeProducts(cb: (p: Product) => void) {
    this.listeners.add(cb)
    const ch = this.sb
      .channel('products-sync-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
        if (payload.new && (payload.new as any).id) cb(mapProduct(payload.new))
      })
      .subscribe()
    return () => {
      this.listeners.delete(cb)
      this.sb.removeChannel(ch)
    }
  }

  async postOperation(input: OperationInput) {
    const id = check(await this.sb.rpc('post_operation', { p: input })) as string
    const op = await this.getOperation(id)
    if (!op) throw new OpError('Операция проведена, но не загружена')
    await this.refreshProducts(op.items.map((i) => i.product_id))
    return op
  }

  async cancelSale(id: string, reason: string) {
    const newId = check(await this.sb.rpc('cancel_sale', { p_id: id, p_reason: reason })) as string
    const op = (await this.getOperation(newId))!
    await this.refreshProducts(op.items.map((i) => i.product_id))
    return op
  }

  async listOperations(q: OperationQuery) {
    const build = (a: number, b: number) => {
      let query = this.sb.from('operations').select(OP_SELECT).order('created_at', { ascending: false })
      if (q.from) query = query.gte('created_at', q.from)
      if (q.to) query = query.lt('created_at', q.to)
      if (q.types) query = query.in('type', q.types)
      return query.range(a, b)
    }
    if (q.limit && q.limit <= PAGE) return (check(await build(0, q.limit - 1)) as any[]).map(mapOp)
    const rows = await this.fetchAll(build)
    return (q.limit ? rows.slice(0, q.limit) : rows).map(mapOp)
  }

  async getOperation(id: string) {
    const r = check(await this.sb.from('operations').select(OP_SELECT).eq('id', id).maybeSingle())
    return r ? mapOp(r) : null
  }

  async listLinkedOperations(id: string) {
    return (check(await this.sb.from('operations').select(OP_SELECT).eq('ref_id', id)) as any[]).map(mapOp)
  }

  async productHistory(productId: string): Promise<ProductMovement[]> {
    const rows = await this.fetchAll((a, b) =>
      this.sb.from('operation_items')
        .select('*, op:operations(id,number,type,status,created_at,user_name,reason)')
        .eq('product_id', productId).order('id', { ascending: false }).range(a, b))
    return rows.map((r) => ({ op: { ...r.op, number: n(r.op.number) }, item: mapItem(r) }))
  }

  async listStaff() { return check(await this.sb.from('profiles').select('*').order('created_at')) as Profile[] }

  async setStaffRole(id: string, role: Role) {
    const rows = check(await this.sb.from('profiles').update({ role }).eq('id', id).select()) as any[]
    if (!rows.length) throw new OpError('Недостаточно прав')
  }

  async setStaffName(id: string, name: string) {
    check(await this.sb.from('profiles').update({ name: name.trim() }).eq('id', id))
  }

  async exportBackup(): Promise<BackupData> {
    const [settings, categories, banks, products, operations] = await Promise.all([
      this.getSettings(), this.listCategories(), this.listBanks(), this.listProducts(), this.listOperations({}),
    ])
    return { version: 1, created_at: new Date().toISOString(), settings, categories, banks, products, operations }
  }
}
