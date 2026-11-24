import { useEffect, useState } from 'react'
import OperationView, { opDoc } from '../components/OperationView'
import { Empty, Modal, NumInput, Page, ProductFinder, Tabs, useConfirm } from '../components/ui'
import { exportXlsx, printDoc } from '../lib/export'
import { dateTime, errorText, money, num, round2, round3 } from '../lib/format'
import { auditTotals } from '../lib/reports'
import { useStore, useToast } from '../lib/store'
import type { Operation, Product } from '../lib/types'

interface Counted { product_id: string; expected: number; actual: number }
interface Draft { started_at: string; items: Counted[]; mode: 'enter' | 'plus1' }

const KEY = 'audit-draft'

function loadDraft(): Draft | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
}

export default function Audit() {
  const [draft, setDraft] = useState<Draft | null>(loadDraft)
  const [tab, setTab] = useState<'current' | 'history'>('current')
  const [report, setReport] = useState<string | null>(null)

  useEffect(() => {
    try {
      if (draft) localStorage.setItem(KEY, JSON.stringify(draft))
      else localStorage.removeItem(KEY)
    } catch { /* ignore */ }
  }, [draft])

  return (
    <Page title="Ревизия">
      <Tabs value={tab} onChange={setTab} items={[['current', draft ? 'Текущая ревизия' : 'Новая ревизия'], ['history', 'История ревизий']]} />
      {tab === 'current' ? (
        draft ? (
          <CurrentAudit draft={draft} setDraft={setDraft} onFinished={(op) => { setDraft(null); setReport(op.id); setTab('history') }} />
        ) : (
          <div className="center-block">
            <Empty icon="📋" text="Сканируйте товары и вводите фактическое количество — приложение посчитает недостачу и излишки." />
            <button className="btn btn-primary btn-lg wide" onClick={() => setDraft({ started_at: new Date().toISOString(), items: [], mode: 'enter' })}>
              Начать ревизию
            </button>
          </div>
        )
      ) : <AuditHistory />}
      {report && <OperationView id={report} onClose={() => setReport(null)} />}
    </Page>
  )
}

function CurrentAudit({ draft, setDraft, onFinished }: { draft: Draft; setDraft: (d: Draft | null) => void; onFinished: (op: Operation) => void }) {
  const { backend, productById, findByBarcode, products } = useStore()
  const toast = useToast()
  const confirm = useConfirm()
  const [count, setCount] = useState<Product | null>(null)
  const [finish, setFinish] = useState(false)
  const [zeroRest, setZeroRest] = useState(false)
  const [busy, setBusy] = useState(false)

  const setItem = (p: Product, actual: number) => {
    const exist = draft.items.find((i) => i.product_id === p.id)
    const item: Counted = { product_id: p.id, expected: exist?.expected ?? p.stock, actual: round3(actual) }
    setDraft({ ...draft, items: [item, ...draft.items.filter((i) => i.product_id !== p.id)] })
  }

  const onScan = (code: string) => {
    const p = findByBarcode(code)
    if (!p) return { ok: false, title: 'Товар не найден', subtitle: code }
    if (draft.mode === 'plus1') {
      const exist = draft.items.find((i) => i.product_id === p.id)
      const actual = (exist?.actual ?? 0) + 1
      setItem(p, actual)
      return { ok: true, title: p.name, subtitle: `Посчитано: ${num(actual)} · по базе: ${num(exist?.expected ?? p.stock)}` }
    }
    setCount(p)
    return { ok: true, title: p.name, subtitle: `По базе: ${num(p.stock)} ${p.unit}` }
  }

  const rows = draft.items.map((i) => ({ ...i, p: productById.get(i.product_id), diff: round3(i.actual - i.expected) })).filter((r) => r.p) as
    (Counted & { p: Product; diff: number })[]
  const shortage = rows.filter((r) => r.diff < 0)
  const surplus = rows.filter((r) => r.diff > 0)
  const shortageSum = round2(shortage.reduce((s, r) => s + -r.diff * r.p.purchase_price, 0))
  const surplusSum = round2(surplus.reduce((s, r) => s + r.diff * r.p.purchase_price, 0))
  const counted = new Set(draft.items.map((i) => i.product_id))
  const unchecked = products.filter((p) => !p.archived && !counted.has(p.id) && p.stock !== 0)

  const doFinish = async () => {
    const items = rows.map((r) => ({ product_id: r.product_id, expected_qty: r.expected, actual_qty: r.actual }))
    if (zeroRest) for (const p of unchecked) items.push({ product_id: p.id, expected_qty: p.stock, actual_qty: 0 })
    if (!items.length) return toast.error('Нет проверенных товаров')
    setBusy(true)
    try {
      const op = await backend.postOperation({ type: 'audit', items, comment: `Ревизия начата ${dateTime(draft.started_at)}${zeroRest ? ', полная' : ''}` })
      toast.ok('Ревизия завершена, остатки исправлены')
      setFinish(false)
      onFinished(op)
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="muted small">Начата: {dateTime(draft.started_at)}</div>
      <Tabs value={draft.mode} onChange={(mode) => setDraft({ ...draft, mode })}
        items={[['enter', 'Скан → ввести кол-во'], ['plus1', 'Каждый скан = +1']]} />
      <ProductFinder onPick={(p) => setCount(p)} onScan={onScan} continuous={draft.mode === 'plus1'} scanTitle="Ревизия: сканируйте товары" />

      <div className="audit-stats">
        <div><span>Проверено</span><b>{rows.length}</b></div>
        <div className="red-text"><span>Недостача</span><b>{money(shortageSum)}</b></div>
        <div className="green-text"><span>Излишки</span><b>{money(surplusSum)}</b></div>
      </div>

      {rows.length === 0 ? <Empty icon="📋" text="Пока ничего не проверено" /> : (
        <div className="list">
          {rows.map((r) => (
            <button key={r.product_id} className="list-row" onClick={() => setCount(r.p)}>
              <div className="row-main">
                <div className="row-title">{r.p.name}</div>
                <div className="row-sub">По базе: {num(r.expected)} · Факт: {num(r.actual)}</div>
              </div>
              <div className="row-right">
                <div className={'row-price ' + (r.diff < 0 ? 'red-text' : r.diff > 0 ? 'green-text' : '')}>
                  {r.diff === 0 ? '✓ совпадает' : r.diff < 0 ? `Недостача ${num(-r.diff)}` : `Излишек +${num(r.diff)}`}
                </div>
                {r.diff !== 0 && <div className="row-sub">{money(Math.abs(r.diff) * r.p.purchase_price)}</div>}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="row-gap pad">
        <button className="btn btn-primary btn-lg grow" onClick={() => setFinish(true)}>Завершить ревизию</button>
        <button className="btn btn-danger" onClick={async () => { if (await confirm.ask('Отменить ревизию? Введённые данные будут удалены.', { danger: true })) setDraft(null) }}>Отменить</button>
      </div>

      {count && (
        <CountModal p={count} counted={draft.items.find((i) => i.product_id === count.id)}
          onClose={() => setCount(null)}
          onSave={(actual) => { setItem(count, actual); setCount(null) }}
          onRemove={() => { setDraft({ ...draft, items: draft.items.filter((i) => i.product_id !== count.id) }); setCount(null) }} />
      )}

      {finish && (
        <Modal title="Завершение ревизии" onClose={() => setFinish(false)} footer={
          <>
            <button className="btn" onClick={() => setFinish(false)}>Назад</button>
            <button className="btn btn-primary" disabled={busy} onClick={doFinish}>{busy ? 'Сохранение…' : 'Завершить и исправить остатки'}</button>
          </>
        }>
          <div className="kv">
            <div><span>Проверено товаров</span><b>{rows.length}</b></div>
            <div><span>Недостача</span><b className="red-text">{num(shortage.reduce((s, r) => s - r.diff, 0))} ед. · {money(shortageSum)}</b></div>
            <div><span>Излишки</span><b className="green-text">{num(surplus.reduce((s, r) => s + r.diff, 0))} ед. · {money(surplusSum)}</b></div>
          </div>
          {unchecked.length > 0 && (
            <label className="check">
              <input type="checkbox" checked={zeroRest} onChange={(e) => setZeroRest(e.target.checked)} />
              <span>Полная ревизия: считать непроверенные товары отсутствующими ({unchecked.length} поз., остаток станет 0)</span>
            </label>
          )}
          <p className="muted small">После завершения остатки в базе будут заменены фактическими, отчёт сохранится в истории.</p>
        </Modal>
      )}
      {confirm.node}
    </>
  )
}

function CountModal({ p, counted, onClose, onSave, onRemove }: {
  p: Product; counted?: Counted; onClose: () => void; onSave: (v: number) => void; onRemove: () => void
}) {
  const expected = counted?.expected ?? p.stock
  const [actual, setActual] = useState<number | null>(counted ? counted.actual : null)
  const [add, setAdd] = useState<number | null>(null)
  const value = counted && add != null ? round3(counted.actual + add) : actual
  const diff = value == null ? null : round3(value - expected)
  const save = () => { if (value != null && value >= 0) onSave(value) }

  return (
    <Modal title={p.name} onClose={onClose} footer={
      <>
        {counted && <button className="btn btn-danger" onClick={onRemove}>Убрать</button>}
        <button className="btn btn-primary btn-lg grow" disabled={value == null || value < 0} onClick={save}>Сохранить</button>
      </>
    }>
      <div className="count-box">
        <div><span>По базе</span><b>{num(expected)} {p.unit}</b></div>
        {counted && <div><span>Уже посчитано</span><b>{num(counted.actual)} {p.unit}</b></div>}
      </div>
      {counted ? (
        <div className="grid2">
          <label className="field"><span className="field-label">Факт (заменить)</span>
            <NumInput value={actual} onChange={(v) => { setActual(v); setAdd(null) }} onEnter={save} />
          </label>
          <label className="field"><span className="field-label">Или прибавить</span>
            <NumInput value={add} onChange={setAdd} placeholder="+0" onEnter={save} />
          </label>
        </div>
      ) : (
        <label className="field"><span className="field-label">Фактическое количество</span>
          <NumInput value={actual} onChange={setActual} autoFocus className="big-input" onEnter={save} />
        </label>
      )}
      {diff != null && (
        <div className={'diff-box ' + (diff < 0 ? 'red' : diff > 0 ? 'green' : 'ok')}>
          {diff === 0 ? '✓ Совпадает с базой' : diff < 0
            ? `Недостача: ${num(-diff)} ${p.unit} · ${money(-diff * p.purchase_price)}`
            : `Излишек: ${num(diff)} ${p.unit} · ${money(diff * p.purchase_price)}`}
        </div>
      )}
    </Modal>
  )
}

function AuditHistory() {
  const { backend, shopName } = useStore()
  const toast = useToast()
  const [ops, setOps] = useState<Operation[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    backend.listOperations({ types: ['audit'], limit: 200 }).then(setOps).catch((e) => toast.error(errorText(e)))
  }, [backend, toast])

  if (!ops) return <div className="muted pad">Загрузка…</div>
  if (!ops.length) return <Empty icon="📋" text="Ревизий ещё не было" />

  return (
    <>
      <div className="list">
        {ops.map((o) => {
          const t = auditTotals(o)
          return (
            <div key={o.id} className="list-row static">
              <button className="row-main as-link" onClick={() => setOpen(o.id)}>
                <div className="row-title">Ревизия №{o.number} · {dateTime(o.created_at)}</div>
                <div className="row-sub">Проверено: {t.checked} · <span className="red-text">недостача {money(t.shortageCost)}</span> · <span className="green-text">излишки {money(t.surplusCost)}</span></div>
              </button>
              <div className="row-right row-gap">
                <button className="btn btn-sm" onClick={() => exportXlsx(opDoc(o, shopName)).catch((e) => toast.error(errorText(e)))}>Excel</button>
                <button className="btn btn-sm" onClick={() => printDoc(opDoc(o, shopName))}>PDF</button>
              </div>
            </div>
          )
        })}
      </div>
      {open && <OperationView id={open} onClose={() => setOpen(null)} />}
    </>
  )
}
