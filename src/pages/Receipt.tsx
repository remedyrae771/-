import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import OperationView from '../components/OperationView'
import ProductForm from '../components/ProductForm'
import { Empty, Field, NumInput, Page, ProductFinder, Tabs, useConfirm } from '../components/ui'
import { exportXlsx } from '../lib/export'
import { dateTime, errorText, money, num, round2 } from '../lib/format'
import { useStore, useToast } from '../lib/store'
import type { Operation, Product } from '../lib/types'

interface Line { product_id: string; qty: number; price: number; sale_price: number }

const DRAFT_KEY = 'receipt-draft'

export default function Receipt() {
  const [tab, setTab] = useState<'new' | 'history'>('new')
  return (
    <Page title="Приход товара">
      <Tabs value={tab} onChange={setTab} items={[['new', 'Новый приход'], ['history', 'История приходов']]} />
      {tab === 'new' ? <NewReceipt onDone={() => setTab('history')} /> : <ReceiptHistory />}
    </Page>
  )
}

function NewReceipt({ onDone }: { onDone: () => void }) {
  const { backend, productById, findByBarcode } = useStore()
  const toast = useToast()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const draft = (() => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') } catch { return null } })()
  const [lines, setLines] = useState<Line[]>(draft?.lines ?? [])
  const [supplier, setSupplier] = useState<string>(draft?.supplier ?? '')
  const [comment, setComment] = useState<string>(draft?.comment ?? '')
  const [create, setCreate] = useState<{ barcode?: string; name?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ lines, supplier, comment })) } catch { /* ignore */ }
  }, [lines, supplier, comment])

  const add = (p: Product, qty = 1) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id)
      if (i >= 0) {
        const copy = ls.slice()
        copy[i] = { ...copy[i], qty: round2(copy[i].qty + qty) }
        return [copy[i], ...copy.filter((_, j) => j !== i)]
      }
      return [{ product_id: p.id, qty, price: p.purchase_price, sale_price: p.sale_price }, ...ls]
    })
  }

  // переход из карточки товара: /receipt?product=ID
  useEffect(() => {
    const pid = params.get('product')
    const p = pid ? productById.get(pid) : undefined
    if (p) {
      add(p, 1)
      setParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, productById])

  const onScan = (code: string) => {
    const p = findByBarcode(code)
    if (p) {
      add(p)
      return { ok: true, title: p.name, subtitle: `+1 · на складе ${num(p.stock)} ${p.unit}` }
    }
    setCreate({ barcode: code })
    return { ok: false, title: 'Новый товар', subtitle: `Штрихкод ${code} — заполните карточку` }
  }

  const update = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.product_id === id ? { ...l, ...patch } : l)))
  const items = lines.map((l) => ({ ...l, p: productById.get(l.product_id) })).filter((l) => l.p) as (Line & { p: Product })[]
  const total = round2(items.reduce((s, l) => s + l.qty * l.price, 0))

  const post = async () => {
    if (!items.length) return
    if (items.some((l) => !(l.qty > 0))) return toast.error('Укажите количество для всех товаров')
    const ok = await confirm.ask(`Провести приход: ${items.length} поз. на сумму ${money(total)}?\nОстатки на складе увеличатся.`)
    if (!ok) return
    setBusy(true)
    try {
      const op = await backend.postOperation({
        type: 'receipt', supplier, comment,
        items: items.map((l) => ({
          product_id: l.product_id, qty: l.qty, price: l.price,
          new_sale_price: l.sale_price !== l.p.sale_price ? l.sale_price : undefined,
        })),
      })
      setLines([]); setSupplier(''); setComment('')
      toast.ok(`Приход №${op.number} проведён`)
      onDone()
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ProductFinder onPick={(p) => add(p)} onScan={onScan} showPrice="purchase" scanTitle="Приход: сканируйте товары" />
      <button className="btn wide" onClick={() => setCreate({})}>+ Новый товар (нет в базе)</button>

      {items.length === 0 ? (
        <Empty icon="📦" text="Отсканируйте поступивший товар. Если товара нет в базе — приложение предложит создать карточку." />
      ) : (
        <div className="cart">
          {items.map((l) => (
            <div key={l.product_id} className="cart-line">
              <div className="cart-top">
                <div className="cart-name">{l.p.name}</div>
                <button className="icon-btn small" onClick={() => setLines((ls) => ls.filter((x) => x.product_id !== l.product_id))} aria-label="Удалить">🗑</button>
              </div>
              <div className="muted small">Сейчас на складе: {num(l.p.stock)} {l.p.unit} → станет {num(l.p.stock + l.qty)}</div>
              <div className="grid3">
                <Field label={`Кол-во, ${l.p.unit}`}><NumInput value={l.qty} onChange={(v) => update(l.product_id, { qty: v })} /></Field>
                <Field label="Закуп. цена"><NumInput value={l.price} onChange={(v) => update(l.product_id, { price: v })} /></Field>
                <Field label="Цена продажи"><NumInput value={l.sale_price} onChange={(v) => update(l.product_id, { sale_price: v })} /></Field>
              </div>
              <div className="cart-sum right">{money(l.qty * l.price)}</div>
            </div>
          ))}
          <Field label="Поставщик"><input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Необязательно" /></Field>
          <Field label="Комментарий"><input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: накладная №123" /></Field>
          <div className="sum-line"><span>Итого по закупке</span><b>{money(total)}</b></div>
          <button className="btn btn-primary btn-lg wide" disabled={busy} onClick={post}>{busy ? 'Проведение…' : '✓ Провести приход'}</button>
        </div>
      )}

      {create && (
        <ProductForm initialBarcode={create.barcode} qtyLabel="Поступило, кол-во" onClose={() => setCreate(null)}
          onSaved={(p, qty) => {
            setCreate(null)
            add(p, qty > 0 ? qty : 1)
            toast.ok('Товар добавлен в базу и в приход')
          }} />
      )}
      {confirm.node}
    </>
  )
}

function ReceiptHistory() {
  const { backend } = useStore()
  const toast = useToast()
  const [ops, setOps] = useState<Operation[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    backend.listOperations({ types: ['receipt'], limit: 300 }).then(setOps).catch((e) => toast.error(errorText(e)))
  }, [backend, toast])

  if (!ops) return <div className="muted pad">Загрузка…</div>
  if (!ops.length) return <Empty icon="📦" text="Приходов ещё не было" />

  const exportAll = () => exportXlsx({
    title: 'История поступлений',
    sections: [{
      head: ['№', 'Дата', 'Поставщик', 'Товар', 'Кол-во', 'Цена закупки', 'Сумма', 'Сотрудник'],
      rows: ops.flatMap((o) => o.items.map((i) => [o.number, dateTime(o.created_at), o.supplier ?? '', i.product_name, i.qty, i.price, round2(i.qty * i.price), o.user_name ?? ''])),
      money: [5, 6],
    }],
  }).catch((e) => toast.error(errorText(e)))

  return (
    <>
      <button className="btn wide" onClick={exportAll}>⬇️ Выгрузить в Excel</button>
      <div className="list">
        {ops.map((o) => (
          <button key={o.id} className="list-row" onClick={() => setOpen(o.id)}>
            <div className="row-main">
              <div className="row-title">Приход №{o.number}{o.supplier ? ' · ' + o.supplier : ''}</div>
              <div className="row-sub">{dateTime(o.created_at)} · {o.items.length} поз. · {num(o.items.reduce((s, i) => s + i.qty, 0))} ед.{o.comment ? ' · ' + o.comment : ''}</div>
            </div>
            <div className="row-right"><div className="row-price">{money(o.total)}</div></div>
          </button>
        ))}
      </div>
      {open && <OperationView id={open} onClose={() => setOpen(null)} />}
    </>
  )
}
