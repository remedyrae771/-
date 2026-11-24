import { useState } from 'react'
import { errorText, money, round2 } from '../lib/format'
import { useStore, useToast } from '../lib/store'
import { UNITS, type Product } from '../lib/types'
import Scanner from './Scanner'
import { Field, Modal, NumInput } from './ui'

interface Props {
  product?: Product
  initialBarcode?: string
  initialName?: string
  /** Показать поле количества (для прихода / начального остатка) */
  qtyLabel?: string
  onClose: () => void
  onSaved: (p: Product, qty: number) => void | Promise<void>
}

export default function ProductForm({ product, initialBarcode, initialName, qtyLabel, onClose, onSaved }: Props) {
  const { backend, categories, reloadRefs, upsertProduct, findByBarcode } = useStore()
  const toast = useToast()
  const [name, setName] = useState(product?.name ?? initialName ?? '')
  const [barcode, setBarcode] = useState(product?.barcode ?? initialBarcode ?? '')
  const [categoryId, setCategoryId] = useState(product?.category_id ?? '')
  const [purchase, setPurchase] = useState<number>(product?.purchase_price ?? 0)
  const [sale, setSale] = useState<number>(product?.sale_price ?? 0)
  const [unit, setUnit] = useState(product?.unit ?? 'шт')
  const [qty, setQty] = useState<number>(0)
  const [newCat, setNewCat] = useState<string | null>(null)
  const [scan, setScan] = useState(false)
  const [saving, setSaving] = useState(false)

  const markup = purchase > 0 ? round2(((sale - purchase) / purchase) * 100) : null
  const dup = barcode.trim() ? findByBarcode(barcode.trim()) : undefined
  const dupOther = dup && dup.id !== product?.id ? dup : undefined

  const save = async () => {
    if (!name.trim()) return toast.error('Укажите название товара')
    if (dupOther) return toast.error(`Штрихкод уже используется: ${dupOther.name}`)
    if (qtyLabel && qty < 0) return toast.error('Количество не может быть отрицательным')
    setSaving(true)
    try {
      let catId: string | null = categoryId || null
      if (newCat != null && newCat.trim()) {
        const c = await backend.saveCategory({ name: newCat })
        catId = c.id
        await reloadRefs()
      }
      const saved = await backend.saveProduct({
        id: product?.id, name, barcode: barcode.trim() || null, category_id: catId,
        purchase_price: round2(purchase), sale_price: round2(sale), unit,
      })
      upsertProduct(saved)
      await onSaved(saved, qty)
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={product ? 'Редактировать товар' : 'Новый товар'} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Сохранение…' : 'Сохранить'}</button>
      </>
    }>
      <Field label="Название *">
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!product && !!initialBarcode} placeholder="Например: Молоко 3,2% 1 л" />
      </Field>
      <Field label="Штрихкод" hint={dupOther ? <span className="red-text">Уже есть товар: {dupOther.name}</span> : undefined}>
        <div className="input-with-btn">
          <input value={barcode} inputMode="numeric" onChange={(e) => setBarcode(e.target.value)} placeholder="Отсканируйте или введите" />
          <button type="button" className="btn" onClick={() => setScan(true)}>▥ Скан</button>
        </div>
      </Field>
      <Field label="Категория">
        {newCat == null ? (
          <div className="input-with-btn">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— без категории —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" className="btn" onClick={() => setNewCat('')}>+ Новая</button>
          </div>
        ) : (
          <div className="input-with-btn">
            <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Название новой категории" autoFocus />
            <button type="button" className="btn" onClick={() => setNewCat(null)}>✕</button>
          </div>
        )}
      </Field>
      <div className="grid2">
        <Field label="Закупочная цена, ₸">
          <NumInput value={purchase} onChange={setPurchase} />
        </Field>
        <Field label="Цена продажи, ₸">
          <NumInput value={sale} onChange={setSale} />
        </Field>
      </div>
      {markup != null && (
        <div className={'hint-line ' + (sale < purchase ? 'red-text' : '')}>
          Наценка: {markup}% ({money(sale - purchase)} с единицы)
        </div>
      )}
      <div className="grid2">
        <Field label="Единица">
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        {qtyLabel && (
          <Field label={qtyLabel}>
            <NumInput value={qty} onChange={setQty} />
          </Field>
        )}
      </div>
      {product && <div className="muted small">Остаток меняется только через приход, продажу, списание или ревизию.</div>}
      {scan && (
        <Scanner title="Штрихкод товара" onClose={() => setScan(false)} onDetect={(c) => { setBarcode(c); setScan(false) }} />
      )}
    </Modal>
  )
}
