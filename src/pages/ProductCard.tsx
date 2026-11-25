import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import OperationView from '../components/OperationView'
import ProductForm from '../components/ProductForm'
import { Empty, Page, StockBadge, useConfirm } from '../components/ui'
import { dateTime, errorText, money, num } from '../lib/format'
import { useStore, useToast } from '../lib/store'
import { canManage, OP_ICON, OP_LABEL, WRITEOFF_REASONS, type ProductMovement } from '../lib/types'

export default function ProductCard() {
  const { id } = useParams()
  const { productById, categories, profile, backend, upsertProduct } = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const confirm = useConfirm()
  const p = productById.get(id!)
  const [edit, setEdit] = useState(false)
  const [history, setHistory] = useState<ProductMovement[] | null>(null)
  const [openOp, setOpenOp] = useState<string | null>(null)
  const manager = canManage(profile.role)

  const stock = p?.stock
  useEffect(() => {
    if (!id) return
    backend.productHistory(id).then(setHistory).catch((e) => toast.error(errorText(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, stock])

  if (!p) return <Page title="Товар" back="/products"><Empty text="Товар не найден" /></Page>

  const cat = categories.find((c) => c.id === p.category_id)?.name
  const markup = p.purchase_price > 0 ? Math.round(((p.sale_price - p.purchase_price) / p.purchase_price) * 1000) / 10 : null

  const totals = { in: 0, out: 0 }
  for (const h of history ?? []) {
    if (h.op.type === 'receipt') totals.in += h.item.qty
    if (h.op.type === 'sale' && h.op.status === 'done') totals.out += h.item.qty
  }

  const toggleArchive = async () => {
    const ok = await confirm.ask(p.archived ? 'Вернуть товар из архива?' : 'Убрать товар в архив? Он перестанет показываться в поиске, история сохранится.')
    if (!ok) return
    try {
      await backend.setProductArchived(p.id, !p.archived)
      upsertProduct({ ...p, archived: !p.archived })
      toast.ok(p.archived ? 'Товар восстановлен' : 'Товар в архиве')
    } catch (e) { toast.error(errorText(e)) }
  }

  return (
    <Page title="Карточка товара" back="/products" actions={manager && <button className="link" onClick={() => setEdit(true)}>Изменить</button>}>
      <div className="card">
        <div className="pc-name">{p.name}</div>
        <div className="muted">{p.barcode ? `Штрихкод: ${p.barcode}` : 'Без штрихкода'}{cat ? ` · ${cat}` : ''}</div>
        <div className="pc-stock">
          <span>Остаток</span>
          <StockBadge p={p} />
        </div>
        <div className="kv">
          <div><span>Цена продажи</span><b>{money(p.sale_price)}</b></div>
          {manager && <div><span>Закупочная цена</span><b>{money(p.purchase_price)}</b></div>}
          {manager && markup != null && <div><span>Наценка</span><b>{markup}%</b></div>}
          {manager && <div><span>Сумма остатка (закуп.)</span><b>{money(p.stock * p.purchase_price)}</b></div>}
          <div><span>Всего поступило</span><b>{num(totals.in)} {p.unit}</b></div>
          <div><span>Всего продано</span><b>{num(totals.out)} {p.unit}</b></div>
        </div>
        {p.archived && <div className="badge gray">В архиве</div>}
      </div>

      <div className="section-title">История поступлений и продаж</div>
      {history == null ? <div className="muted pad">Загрузка…</div> : history.length === 0 ? (
        <Empty icon="🕘" text="Операций по товару ещё не было" />
      ) : (
        <div className="list">
          {history.map((h, i) => (
            <button key={i} className={'list-row' + (h.op.status === 'cancelled' ? ' cancelled' : '')} onClick={() => setOpenOp(h.op.id)}>
              <div className="row-main">
                <div className="row-title">{OP_ICON[h.op.type]} {OP_LABEL[h.op.type]} №{h.op.number}{h.op.status === 'cancelled' ? ' (отменена)' : ''}</div>
                <div className="row-sub">{dateTime(h.op.created_at)}{h.op.user_name ? ' · ' + h.op.user_name : ''}{h.op.reason ? ' · ' + (WRITEOFF_REASONS[h.op.reason] ?? h.op.reason) : ''}</div>
              </div>
              <div className="row-right">
                <div className={'row-price ' + (h.item.delta < 0 ? 'red-text' : h.item.delta > 0 ? 'green-text' : '')}>
                  {h.item.delta > 0 ? '+' : ''}{num(h.item.delta)} {p.unit}
                </div>
                {h.op.type !== 'audit' && <div className="row-sub">{money(h.item.price)} / {p.unit}</div>}
              </div>
            </button>
          ))}
        </div>
      )}

      {manager && (
        <div className="row-gap pad">
          <button className="btn" onClick={() => nav('/receipt?product=' + p.id)}>📦 Приход</button>
          <button className="btn" onClick={() => nav('/returns/writeoff?product=' + p.id)}>🗑️ Списать</button>
          <button className="btn" onClick={toggleArchive}>{p.archived ? 'Вернуть из архива' : 'В архив'}</button>
        </div>
      )}

      {edit && <ProductForm product={p} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); toast.ok('Сохранено') }} />}
      {openOp && <OperationView id={openOp} onClose={() => setOpenOp(null)} />}
      {confirm.node}
    </Page>
  )
}
