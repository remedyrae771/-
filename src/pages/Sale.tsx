import { useEffect, useState } from 'react'
import PaymentSplit, { paymentsValid } from '../components/PaymentSplit'
import ProductForm from '../components/ProductForm'
import { opDoc } from '../components/OperationView'
import { Empty, Modal, NumInput, Page, ProductFinder, QtyStepper, StockBadge } from '../components/ui'
import { printDoc } from '../lib/export'
import { errorText, money, num, round2 } from '../lib/format'
import { useStore, useToast } from '../lib/store'
import { canManage, PAY_LABEL, type Operation, type Payment, type Product } from '../lib/types'

interface CartLine { product_id: string; qty: number; price: number }

const DRAFT_KEY = 'sale-cart-draft'

function loadDraft(): CartLine[] {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]') } catch { return [] }
}

export default function Sale() {
  const { backend, productById, findByBarcode, profile, shopName } = useStore()
  const toast = useToast()
  const [cart, setCart] = useState<CartLine[]>(loadDraft)
  const [paying, setPaying] = useState(false)
  const [payments, setPayments] = useState<Payment[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Operation | null>(null)
  const [notFound, setNotFound] = useState<string | null>(null)
  const [createCode, setCreateCode] = useState<string | null>(null)
  const manager = canManage(profile.role)

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(cart)) } catch { /* ignore */ }
  }, [cart])

  const lines = cart.map((l) => ({ ...l, p: productById.get(l.product_id) })).filter((l) => l.p) as (CartLine & { p: Product })[]
  const total = round2(lines.reduce((s, l) => s + l.qty * l.price, 0))
  const count = lines.reduce((s, l) => s + l.qty, 0)

  const add = (p: Product) => {
    let newQty = 1
    setCart((c) => {
      const i = c.findIndex((l) => l.product_id === p.id)
      if (i >= 0) {
        newQty = c[i].qty + 1
        const copy = c.slice()
        copy[i] = { ...copy[i], qty: newQty }
        return copy
      }
      return [{ product_id: p.id, qty: 1, price: p.sale_price }, ...c]
    })
    return newQty
  }

  const onScan = (code: string) => {
    const p = findByBarcode(code)
    if (!p) {
      setNotFound(code)
      return { ok: false, title: 'Товар не найден', subtitle: `Штрихкод ${code}` }
    }
    const inCart = (cart.find((l) => l.product_id === p.id)?.qty ?? 0) + 1
    add(p)
    const warn = inCart > p.stock ? ' ⚠️ больше, чем на складе' : ''
    return { ok: true, title: `${p.name} — ${money(p.sale_price)}`, subtitle: `На складе: ${num(p.stock)} ${p.unit} · в корзине: ${num(inCart)}${warn}` }
  }

  const setQty = (id: string, qty: number) => setCart((c) => c.map((l) => (l.product_id === id ? { ...l, qty } : l)))
  const setPrice = (id: string, price: number) => setCart((c) => c.map((l) => (l.product_id === id ? { ...l, price } : l)))
  const remove = (id: string) => setCart((c) => c.filter((l) => l.product_id !== id))

  const openPay = () => {
    if (lines.some((l) => !(l.qty > 0))) return toast.error('Укажите количество для всех товаров')
    setPayments([{ method: 'cash', amount: total }])
    setPaying(true)
  }

  const confirm = async () => {
    setBusy(true)
    try {
      const op = await backend.postOperation({
        type: 'sale',
        items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, price: l.price })),
        payments: payments.filter((p) => p.amount > 0),
      })
      setCart([])
      setPaying(false)
      setDone(op)
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page title="Продажа" actions={cart.length > 0 && <button className="link danger" onClick={() => setCart([])}>Очистить</button>}
      footer={
        <div className="sale-footer">
          <div>
            <div className="muted small">{lines.length} поз. · {num(count)} ед.</div>
            <div className="sale-total">{money(total)}</div>
          </div>
          <button className="btn btn-primary btn-lg" disabled={!lines.length} onClick={openPay}>Оплата →</button>
        </div>
      }>
      <ProductFinder onPick={add} onScan={onScan} scanTitle="Продажа: сканируйте товары" />

      {notFound && (
        <div className="notice">
          <div>Товар со штрихкодом <b>{notFound}</b> не найден в базе.</div>
          <div className="row-gap">
            {manager && <button className="btn btn-sm btn-primary" onClick={() => { setCreateCode(notFound); setNotFound(null) }}>Создать товар</button>}
            <button className="btn btn-sm" onClick={() => setNotFound(null)}>Закрыть</button>
          </div>
        </div>
      )}
      {createCode && (
        <ProductForm initialBarcode={createCode} onClose={() => setCreateCode(null)}
          onSaved={(p) => { setCreateCode(null); add(p); toast.ok('Товар создан. Остаток 0 — оформите приход.') }} />
      )}

      {lines.length === 0 ? (
        <Empty icon="🛒" text="Корзина пуста. Отсканируйте товар или найдите его по названию." />
      ) : (
        <div className="cart">
          {lines.map((l) => (
            <div key={l.product_id} className={'cart-line' + (l.qty > l.p.stock ? ' over' : '')}>
              <div className="cart-top">
                <div className="cart-name">{l.p.name}</div>
                <button className="icon-btn small" onClick={() => remove(l.product_id)} aria-label="Удалить">🗑</button>
              </div>
              <div className="cart-info">
                <PriceEdit value={l.price} base={l.p.sale_price} onChange={(v) => setPrice(l.product_id, v)} />
                <StockBadge p={l.p} />
              </div>
              <div className="cart-bottom">
                <QtyStepper value={l.qty} onChange={(v) => setQty(l.product_id, v)} />
                <div className="cart-sum">{money(l.qty * l.price)}</div>
              </div>
              {l.qty > l.p.stock && <div className="warn-text small">На складе только {num(l.p.stock)} {l.p.unit}</div>}
            </div>
          ))}
        </div>
      )}

      {paying && (
        <Modal title="Оплата" onClose={() => setPaying(false)} footer={
          <button className="btn btn-primary btn-lg wide" disabled={busy || !paymentsValid(payments, total)} onClick={confirm}>
            {busy ? 'Проведение…' : `✓ Подтвердить продажу ${money(total)}`}
          </button>
        }>
          <PaymentSplit total={total} value={payments} onChange={setPayments} />
        </Modal>
      )}

      {done && (
        <Modal title="Продажа проведена" onClose={() => setDone(null)} footer={
          <>
            <button className="btn" onClick={() => printDoc(opDoc(done, shopName))}>🖨 Чек / PDF</button>
            <button className="btn btn-primary btn-lg" onClick={() => setDone(null)}>Новая продажа</button>
          </>
        }>
          <div className="success">
            <div className="success-icon">✓</div>
            <div className="success-sum">{money(done.total)}</div>
            <div className="muted">Продажа №{done.number}</div>
            <div className="kv">
              {done.payments.map((p, i) => (
                <div key={i}><span>{p.method === 'bank' ? p.bank_name : PAY_LABEL[p.method]}</span><b>{money(p.amount)}</b></div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </Page>
  )
}

function PriceEdit({ value, base, onChange }: { value: number; base: number; onChange: (v: number) => void }) {
  const [edit, setEdit] = useState(false)
  if (!edit) {
    return (
      <button className="link price-link" onClick={() => setEdit(true)}>
        {money(value)} {value !== base && <s className="muted">{money(base)}</s>} ✎
      </button>
    )
  }
  return (
    <span className="price-edit">
      <NumInput value={value} onChange={onChange} autoFocus onEnter={() => setEdit(false)} />
      <button className="btn btn-sm" onClick={() => setEdit(false)}>OK</button>
    </span>
  )
}
