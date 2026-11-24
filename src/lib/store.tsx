import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Backend } from '../backend'
import { errorText, norm } from './format'
import type { Bank, Category, Product, Profile } from './types'

interface StoreValue {
  backend: Backend
  profile: Profile
  products: Product[]
  productById: Map<string, Product>
  categories: Category[]
  banks: Bank[]
  settings: Record<string, unknown>
  shopName: string
  loading: boolean
  reload: () => Promise<void>
  reloadRefs: () => Promise<void>
  upsertProduct: (p: Product) => void
  findByBarcode: (code: string) => Product | undefined
  search: (q: string, opts?: { includeArchived?: boolean; categoryId?: string | null; limit?: number }) => Product[]
  signOut: () => Promise<void>
}

const Ctx = createContext<StoreValue | null>(null)

export function useStore() {
  const v = useContext(Ctx)
  if (!v) throw new Error('StoreProvider missing')
  return v
}

export function StoreProvider({ backend, profile, onSignOut, children }: {
  backend: Backend; profile: Profile; onSignOut: () => Promise<void>; children: ReactNode
}) {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  const lastLoad = useRef(0)

  const reloadRefs = useCallback(async () => {
    const [c, b, s] = await Promise.all([backend.listCategories(), backend.listBanks(), backend.getSettings()])
    setCategories(c)
    setBanks(b)
    setSettings(s)
  }, [backend])

  const reload = useCallback(async () => {
    try {
      const [p] = await Promise.all([backend.listProducts(), reloadRefs()])
      setProducts(p)
      lastLoad.current = Date.now()
    } catch (e) {
      toast.error('Не удалось загрузить данные: ' + errorText(e))
    } finally {
      setLoading(false)
    }
  }, [backend, reloadRefs, toast])

  useEffect(() => { reload() }, [reload])

  const upsertProduct = useCallback((p: Product) => {
    setProducts((list) => {
      const i = list.findIndex((x) => x.id === p.id)
      if (i < 0) return [...list, p]
      const copy = list.slice()
      copy[i] = p
      return copy
    })
  }, [])

  // Синхронизация остатков с другими устройствами
  useEffect(() => backend.subscribeProducts(upsertProduct), [backend, upsertProduct])

  // При возвращении в приложение — обновляем данные (на случай пропущенных событий)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current > 30_000) reload()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [reload])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const byBarcode = useMemo(() => {
    const m = new Map<string, Product>()
    for (const p of products) if (p.barcode) m.set(p.barcode, p)
    return m
  }, [products])

  const findByBarcode = useCallback((code: string) => {
    const c = code.trim()
    return byBarcode.get(c) ?? (c.length === 12 ? byBarcode.get('0' + c) : c.length === 13 && c.startsWith('0') ? byBarcode.get(c.slice(1)) : undefined)
  }, [byBarcode])

  const indexed = useMemo(() => products.map((p) => ({ p, s: norm(p.name) + ' ' + (p.barcode ?? '') })), [products])

  const search = useCallback((q: string, opts?: { includeArchived?: boolean; categoryId?: string | null; limit?: number }) => {
    const words = norm(q).split(/\s+/).filter(Boolean)
    const res: Product[] = []
    for (const { p, s } of indexed) {
      if (!opts?.includeArchived && p.archived) continue
      if (opts?.categoryId && p.category_id !== opts.categoryId) continue
      if (words.every((w) => s.includes(w))) res.push(p)
    }
    res.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    return opts?.limit ? res.slice(0, opts.limit) : res
  }, [indexed])

  const value: StoreValue = {
    backend, profile, products, productById, categories, banks, settings,
    shopName: (settings.shop_name as string) || 'Мой магазин',
    loading, reload, reloadRefs, upsertProduct, findByBarcode, search, signOut: onSignOut,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// ---------------- Уведомления ----------------

type ToastKind = 'ok' | 'error' | 'info'
interface ToastItem { id: number; kind: ToastKind; text: string }
interface ToastApi { ok: (t: string) => void; error: (t: string) => void; info: (t: string) => void }

const ToastCtx = createContext<ToastApi | null>(null)

export function useToast() {
  const v = useContext(ToastCtx)
  if (!v) throw new Error('ToastProvider missing')
  return v
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq.current
    setItems((l) => [...l.slice(-2), { id, kind, text }])
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2500)
  }, [])
  const api = useMemo<ToastApi>(() => ({
    ok: (t) => push('ok', t), error: (t) => push('error', t), info: (t) => push('info', t),
  }), [push])
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={'toast toast-' + t.kind} onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
