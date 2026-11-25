import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import ProductForm from '../components/ProductForm'
import Scanner from '../components/Scanner'
import { Empty, Page, StockBadge, Tabs } from '../components/ui'
import { exportXlsx } from '../lib/export'
import { errorText, money } from '../lib/format'
import { useStore, useToast } from '../lib/store'
import { canManage } from '../lib/types'

type Filter = 'all' | 'out' | 'archived'

export default function Products() {
  const { search, categories, profile, findByBarcode, backend, products, loading } = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const filter = (params.get('filter') as Filter) || 'all'
  const [scan, setScan] = useState(false)
  const [create, setCreate] = useState<{ barcode?: string } | null>(null)
  const manager = canManage(profile.role)
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  let list = search(q, { includeArchived: filter === 'archived', categoryId: cat })
  if (filter === 'archived') list = list.filter((p) => p.archived)
  if (filter === 'out') list = list.filter((p) => p.stock <= 0)

  const active = products.filter((p) => !p.archived)
  const totalCost = active.reduce((s, p) => s + Math.max(0, p.stock) * p.purchase_price, 0)
  const totalSale = active.reduce((s, p) => s + Math.max(0, p.stock) * p.sale_price, 0)

  const exportList = () => exportXlsx({
    title: 'Остатки товаров',
    subtitle: new Date().toLocaleString('ru-RU'),
    sections: [{
      head: manager
        ? ['Название', 'Штрихкод', 'Категория', 'Ед.', 'Остаток', 'Закуп. цена', 'Цена продажи', 'Сумма по закупке', 'Сумма по продаже']
        : ['Название', 'Штрихкод', 'Категория', 'Ед.', 'Остаток', 'Цена продажи'],
      rows: list.map((p) => manager
        ? [p.name, p.barcode ?? '', catName.get(p.category_id ?? '') ?? '', p.unit, p.stock, p.purchase_price, p.sale_price, p.stock * p.purchase_price, p.stock * p.sale_price]
        : [p.name, p.barcode ?? '', catName.get(p.category_id ?? '') ?? '', p.unit, p.stock, p.sale_price]),
      money: manager ? [5, 6, 7, 8] : [5],
    }],
  }).catch((e) => toast.error(errorText(e)))

  return (
    <Page title="База товаров" actions={<button className="icon-btn" onClick={exportList} aria-label="Excel">⬇️</button>}
      footer={manager ? <button className="btn btn-primary btn-lg wide" onClick={() => setCreate({})}>+ Добавить товар</button> : undefined}>
      <div className="finder-row">
        <input type="search" className="search-input" placeholder="Поиск по названию или штрихкоду" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-scan" onClick={() => setScan(true)}><span className="scan-ico">▥</span> Скан</button>
      </div>

      <Tabs value={filter} onChange={(f) => setParams(f === 'all' ? {} : { filter: f }, { replace: true })}
        items={[['all', `Все (${active.length})`], ['out', 'Нет в наличии'], ['archived', 'Архив']]} />

      {categories.length > 0 && (
        <div className="chips">
          <button className={'chip' + (cat == null ? ' active' : '')} onClick={() => setCat(null)}>Все категории</button>
          {categories.map((c) => (
            <button key={c.id} className={'chip' + (cat === c.id ? ' active' : '')} onClick={() => setCat(cat === c.id ? null : c.id)}>{c.name}</button>
          ))}
        </div>
      )}

      {manager && filter === 'all' && !q && !cat && active.length > 0 && (
        <div className="stat-line">
          Товар на складе: по закупке <b>{money(totalCost)}</b> · по продаже <b>{money(totalSale)}</b>
        </div>
      )}

      {loading ? <div className="muted pad">Загрузка…</div> : list.length === 0 ? (
        <Empty icon="📚" text={products.length ? 'Ничего не найдено' : 'В базе пока нет товаров. Добавьте товар вручную или через «Приход товара».'} />
      ) : (
        <div className="list">
          {list.slice(0, 500).map((p) => (
            <button key={p.id} className="list-row" onClick={() => nav('/products/' + p.id)}>
              <div className="row-main">
                <div className="row-title">{p.name}{p.archived && <span className="badge gray">архив</span>}</div>
                <div className="row-sub">{p.barcode || 'без штрихкода'}{p.category_id && catName.get(p.category_id) ? ' · ' + catName.get(p.category_id) : ''}</div>
              </div>
              <div className="row-right">
                <div className="row-price">{money(p.sale_price)}</div>
                <StockBadge p={p} />
              </div>
            </button>
          ))}
          {list.length > 500 && <div className="muted pad">Показаны первые 500 — уточните поиск</div>}
        </div>
      )}

      {scan && (
        <Scanner title="Найти товар" onClose={() => setScan(false)} onDetect={(code) => {
          const p = findByBarcode(code)
          if (p) nav('/products/' + p.id)
          else if (manager) setCreate({ barcode: code })
          else toast.error('Товар не найден: ' + code)
        }} />
      )}

      {create && (
        <ProductForm initialBarcode={create.barcode} qtyLabel="Начальный остаток" onClose={() => setCreate(null)}
          onSaved={async (p, qty) => {
            if (qty > 0) {
              try {
                await backend.postOperation({ type: 'receipt', items: [{ product_id: p.id, qty, price: p.purchase_price }], comment: 'Начальный остаток' })
              } catch (e) { toast.error('Товар создан, но остаток не записан: ' + errorText(e)) }
            }
            setCreate(null)
            toast.ok('Товар добавлен в базу')
            nav('/products/' + p.id)
          }} />
      )}
    </Page>
  )
}
