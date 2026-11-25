import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import OperationView from '../components/OperationView'
import PaymentSplit, { paymentsValid } from '../components/PaymentSplit'
import { Empty, Field, Modal, Page, ProductFinder, QtyStepper, useConfirm } from '../components/ui'
import { returnedQty } from '../backend/logic'
import { addDays, dateTime, errorText, money, num, round2 } from '../lib/format'
import { useStore, useToast } from '../lib/store'
import { canManage, OP_ICON, OP_LABEL, WRITEOFF_REASONS, type Operation, type Payment, type Product } from '../lib/types'

export default function Returns() {
  const { backend, profile } = useStore()
  const toast = useToast()
  const manager = canManage(profile.role)
  const [ops, setOps] = useState<Operation[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = () => backend.listOperations({ types: ['writeoff', 'return', 'cancel'], limit: 200 }).then(setOps).catch((e) => toast.error(errorText(e)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [backend])

  return (
    <Page title="Списания и возвраты">
      <div className="tiles small-tiles">
        {manager && (
          <>
            <Link to="/returns/writeoff?reason=spoiled" className="tile t-returns"><span className="tile-icon">🗑️</span><span className="tile-title">Списание испорченного</span></Link>
            <Link to="/returns/writeoff?reason=expired" className="tile t-audit"><span className="tile-icon">⏰</span><span className="tile-title">Списание просрочки</span></Link>
          </>
        )}
        <Link to="/returns/return" className="tile t-receipt"><span className="tile-icon">↩️</span><span className="tile-title">Возврат от покупателя</span></Link>
        {manager && <Link to="/returns/cancel" className="tile t-sale"><span className="tile-icon">❌</span><span className="tile-title">Отмена ошибочной продажи</span></Link>}
      </div>

      <div className="section-title">История списаний, возвратов и отмен</div>
      {!ops ? <div className="muted pad">Загрузка…</div> : !ops.length ? <Empty icon="🗂" text="Операций пока нет" /> : (
        <div className="list">
          {ops.map((o) => (
            <button key={o.id} className="list-row" onClick={() => setOpen(o.id)}>
              <div className="row-main">
                <div className="row-title">{OP_ICON[o.type]} {OP_LABEL[o.type]} №{o.number}</div>
                <div className="row-sub">{dateTime(o.created_at)} · {o.items.map((i) => i.product_name).slice(0, 2).join(', ')}{o.items.length > 2 ? '…' : ''}{o.reason ? ' · ' + (WRITEOFF_REASONS[o.reason] ?? o.reason) : ''}</div>
              </div>
              <div className="row-right"><div className="row-price">{money(o.total)}</div></div>
            </button>
          ))}
        </div>
      )}
      {open && <OperationView id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </Page>
  )
}

// ---------------- Списание ----------------

export function WriteOffForm() {
  const { backend, productById, findByBarcode } = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const confirm = useConfirm()
  const [params] = useSearchParams()
  const [reason, setReason] = useState(params.get('reason') || 'spoiled')
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<{ product_id: string; qty: number }[]>(() => {
    const p = params.get('product')
    return p ? [{ product_id: p, qty: 1 }] : []
  })
  const [busy, setBusy] = useState(false)

  const add = (p: Product) => setLines((ls) => ls.some((l) => l.product_id === p.id)
    ? ls.map((l) => (l.product_id === p.id ? { ...l, qty: l.qty + 1 } : l))
    : [{ product_id: p.id, qty: 1 }, ...ls])

  const items = lines.map((l) => ({ ...l, p: productById.get(l.product_id) })).filter((l) => l.p) as { product_id: string; qty: number; p: Product }[]
  const total = round2(items.reduce((s, l) => s + l.qty * l.p.purchase_price, 0))

  const post = async () => {
    if (!items.length) return
    if (items.some((l) => !(l.qty > 0))) return toast.error('Укажите количество')
    if (!(await confirm.ask(`Списать ${items.length} поз. на ${money(total)} (по закупочной цене)?`, { danger: true, ok: 'Списать' }))) return
    setBusy(true)
    try {
      const op = await backend.postOperation({ type: 'writeoff', reason, comment, items: items.map((l) => ({ product_id: l.product_id, qty: l.qty })) })
      toast.ok(`Списание №${op.number} проведено`)
      nav('/returns')
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page title="Списание товара" back="/returns">
      <Field label="Причина списания">
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          {Object.entries(WRITEOFF_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <ProductFinder onPick={add} showPrice="purchase" scanTitle="Списание: сканируйте товары" onScan={(code) => {
        const p = findByBarcode(code)
        if (!p) return { ok: false, title: 'Товар не найден', subtitle: code }
        add(p)
        return { ok: true, title: p.name, subtitle: `Остаток: ${num(p.stock)} ${p.unit}` }
      }} />
      {items.length === 0 ? <Empty icon="🗑️" text="Добавьте товары для списания" /> : (
        <div className="cart">
          {items.map((l) => (
            <div key={l.product_id} className="cart-line">
              <div className="cart-top">
                <div className="cart-name">{l.p.name}</div>
                <button className="icon-btn small" onClick={() => setLines((ls) => ls.filter((x) => x.product_id !== l.product_id))}>🗑</button>
              </div>
              <div className="muted small">Остаток: {num(l.p.stock)} {l.p.unit} · закуп. {money(l.p.purchase_price)}</div>
              <div className="cart-bottom">
                <QtyStepper value={l.qty} onChange={(v) => setLines((ls) => ls.map((x) => (x.product_id === l.product_id ? { ...x, qty: v } : x)))} />
                <div className="cart-sum">{money(l.qty * l.p.purchase_price)}</div>
              </div>
            </div>
          ))}
          <Field label="Комментарий"><input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Необязательно" /></Field>
          <div className="sum-line"><span>Сумма списания</span><b>{money(total)}</b></div>
          <button className="btn btn-danger btn-lg wide" disabled={busy} onClick={post}>Списать</button>
        </div>
      )}
      {confirm.node}
    </Page>
  )
}

// ---------------- Возврат от покупателя ----------------

interface RLine { product_id: string; name: string; qty: number; price: number; max?: number }

export function ReturnForm() {
  const { backend, productById, findByBarcode } = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const saleId = params.get('sale')
  const [sale, setSale] = useState<Operation | null>(null)
  const [lines, setLines] = useState<RLine[]>([])
  const [pick, setPick] = useState(false)
  const [payments, setPayments] = useState<Payment[]>([])
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!saleId) { setSale(null); return }
    ;(async () => {
      try {
        const s = await backend.getOperation(saleId)
        if (!s || s.type !== 'sale') throw new Error('Продажа не найдена')
        const returned = returnedQty(await backend.listLinkedOperations(saleId))
        setSale(s)
        const merged = new Map<string, RLine>()
        for (const it of s.items) {
          const m = merged.get(it.product_id)
          if (m) m.max = (m.max ?? 0) + it.qty
          else merged.set(it.product_id, { product_id: it.product_id, name: it.product_name, qty: 0, price: it.price, max: it.qty })
        }
        setLines([...merged.values()].map((l) => ({ ...l, max: Math.max(0, (l.max ?? 0) - (returned.get(l.product_id) ?? 0)) })))
      } catch (e) {
        toast.error(errorText(e))
      }
    })()
  }, [saleId, backend, toast])

  const total = round2(lines.reduce((s, l) => s + l.qty * l.price, 0))
  const active = lines.filter((l) => l.qty > 0)

  // способ возврата по умолчанию — как платил покупатель
  useEffect(() => {
    if (sale && sale.payments.length === 1) setPayments([{ ...sale.payments[0], amount: total }])
    else if (payments.length <= 1) setPayments([{ method: payments[0]?.method ?? 'cash', bank_name: payments[0]?.bank_name ?? null, amount: total }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, sale])

  const addFree = (p: Product) => setLines((ls) => ls.some((l) => l.product_id === p.id)
    ? ls.map((l) => (l.product_id === p.id ? { ...l, qty: l.qty + 1 } : l))
    : [...ls, { product_id: p.id, name: p.name, qty: 1, price: p.sale_price }])

  const post = async () => {
    if (!active.length) return toast.error('Укажите количество возвращаемого товара')
    if (active.some((l) => l.max != null && l.qty > l.max)) return toast.error('Количество больше, чем было продано')
    setBusy(true)
    try {
      const op = await backend.postOperation({
        type: 'return', ref_id: sale?.id ?? null, comment,
        items: active.map((l) => ({ product_id: l.product_id, qty: l.qty, price: l.price })),
        payments: payments.filter((p) => p.amount > 0),
      })
      toast.ok(`Возврат №${op.number} оформлен, товар вернулся на склад`)
      nav('/returns')
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page title="Возврат от покупателя" back="/returns">
      {sale ? (
        <div className="notice">
          Возврат по продаже <b>№{sale.number}</b> от {dateTime(sale.created_at)} на {money(sale.total)}
          {sale.status === 'cancelled' && <div className="red-text">Продажа отменена — возврат невозможен</div>}
          <button className="link" onClick={() => { setParams({}); setLines([]) }}>Без чека</button>
        </div>
      ) : (
        <>
          <button className="btn btn-outline wide" onClick={() => setPick(true)}>🧾 Выбрать продажу (по чеку)</button>
          <div className="muted small center">или добавьте товары вручную (возврат без чека):</div>
          <ProductFinder onPick={addFree} scanTitle="Возврат: сканируйте товары" onScan={(code) => {
            const p = findByBarcode(code)
            if (!p) return { ok: false, title: 'Товар не найден', subtitle: code }
            addFree(p)
            return { ok: true, title: p.name, subtitle: money(p.sale_price) }
          }} />
        </>
      )}

      {lines.length === 0 ? <Empty icon="↩️" text="Выберите продажу или добавьте возвращаемые товары" /> : (
        <div className="cart">
          {lines.map((l) => (
            <div key={l.product_id} className={'cart-line' + (l.qty === 0 ? ' dim' : '')}>
              <div className="cart-top">
                <div className="cart-name">{l.name}</div>
                {!sale && <button className="icon-btn small" onClick={() => setLines((ls) => ls.filter((x) => x.product_id !== l.product_id))}>🗑</button>}
              </div>
              <div className="muted small">Цена: {money(l.price)}{l.max != null ? ` · можно вернуть: ${num(l.max)}` : ''}{productById.get(l.product_id) ? '' : ' · товар удалён'}</div>
              <div className="cart-bottom">
                <QtyStepper value={l.qty} onChange={(v) => setLines((ls) => ls.map((x) => (x.product_id === l.product_id ? { ...x, qty: l.max != null ? Math.min(v, l.max) : v } : x)))} />
                <div className="cart-sum">{money(l.qty * l.price)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {active.length > 0 && sale?.status !== 'cancelled' && (
        <>
          <div className="section-title">Как вернуть деньги</div>
          <PaymentSplit total={total} value={payments} onChange={setPayments} refund />
          <Field label="Причина возврата"><input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: не подошёл размер" /></Field>
          <button className="btn btn-primary btn-lg wide" disabled={busy || !paymentsValid(payments, total)} onClick={post}>
            ✓ Оформить возврат {money(total)}
          </button>
        </>
      )}

      {pick && <SalePicker onClose={() => setPick(false)} onPick={(s) => { setPick(false); setParams({ sale: s.id }) }} />}
    </Page>
  )
}

function SalePicker({ onPick, onClose }: { onPick: (s: Operation) => void; onClose: () => void }) {
  const { backend } = useStore()
  const toast = useToast()
  const [sales, setSales] = useState<Operation[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    backend.listOperations({ types: ['sale'], from: addDays(new Date(), -30).toISOString() })
      .then((l) => setSales(l.filter((s) => s.status === 'done'))).catch((e) => toast.error(errorText(e)))
  }, [backend, toast])
  const list = useMemo(() => (sales ?? []).filter((s) => !q.trim() || String(s.number).includes(q.trim()) ||
    s.items.some((i) => i.product_name.toLowerCase().includes(q.trim().toLowerCase()))), [sales, q])
  return (
    <Modal title="Выберите продажу" onClose={onClose} wide>
      <SaleList sales={sales} list={list} q={q} setQ={setQ} onPick={onPick} />
    </Modal>
  )
}

function SaleList({ sales, list, q, setQ, onPick }: { sales: Operation[] | null; list: Operation[]; q: string; setQ: (s: string) => void; onPick: (s: Operation) => void }) {
  return (
    <>
      <input type="search" className="search-input" placeholder="Номер продажи или товар" value={q} onChange={(e) => setQ(e.target.value)} />
      {!sales ? <div className="muted pad">Загрузка…</div> : !list.length ? <Empty text="Продаж не найдено (показаны последние 30 дней)" /> : (
        <div className="list">
          {list.slice(0, 300).map((s) => (
            <button key={s.id} className="list-row" onClick={() => onPick(s)}>
              <div className="row-main">
                <div className="row-title">Продажа №{s.number} · {dateTime(s.created_at)}</div>
                <div className="row-sub">{s.items.map((i) => `${i.product_name} ×${num(i.qty)}`).join(', ')}</div>
              </div>
              <div className="row-right"><div className="row-price">{money(s.total)}</div></div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

// ---------------- Отмена ошибочной продажи ----------------

export function CancelSale() {
  const { backend } = useStore()
  const toast = useToast()
  const [sales, setSales] = useState<Operation[] | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const load = () => backend.listOperations({ types: ['sale'], from: addDays(new Date(), -30).toISOString() })
    .then((l) => setSales(l.filter((s) => s.status === 'done'))).catch((e) => toast.error(errorText(e)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [backend])
  const list = (sales ?? []).filter((s) => !q.trim() || String(s.number).includes(q.trim()) ||
    s.items.some((i) => i.product_name.toLowerCase().includes(q.trim().toLowerCase())))
  return (
    <Page title="Отмена продажи" back="/returns">
      <div className="muted small">Выберите ошибочную продажу. После отмены товар вернётся на склад, а сумма исчезнет из отчётов.</div>
      <SaleList sales={sales} list={list} q={q} setQ={setQ} onPick={(s) => setOpen(s.id)} />
      {open && <OperationView id={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); load() }} />}
    </Page>
  )
}
