import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { printDoc, type ReportDoc } from '../lib/export'
import { dateTime, errorText, money, num } from '../lib/format'
import { auditTotals } from '../lib/reports'
import { useStore, useToast } from '../lib/store'
import { canManage, OP_ICON, OP_LABEL, PAY_LABEL, WRITEOFF_REASONS, type Operation } from '../lib/types'
import { Modal } from './ui'

export function opTitle(op: Operation) {
  return `${OP_ICON[op.type]} ${OP_LABEL[op.type]} №${op.number}`
}

export function opDoc(op: Operation, shopName: string): ReportDoc {
  const doc: ReportDoc = {
    title: `${OP_LABEL[op.type]} №${op.number}`,
    subtitle: `${shopName} · ${dateTime(op.created_at)}${op.user_name ? ' · ' + op.user_name : ''}${op.status === 'cancelled' ? ' · ОТМЕНЕНА' : ''}`,
    sections: [],
  }
  if (op.type === 'audit') {
    const t = auditTotals(op)
    doc.sections.push({
      head: ['Товар', 'По базе', 'Факт', 'Разница', 'Сумма разницы (закуп.)'],
      rows: op.items.map((i) => [i.product_name, i.expected_qty ?? 0, i.actual_qty ?? 0, i.delta, Math.round(i.delta * i.cost * 100) / 100]),
      money: [4],
    })
    doc.sections.push({
      title: 'Итоги ревизии',
      rows: [
        ['Проверено товаров', t.checked],
        ['Недостача, ед.', t.shortageQty],
        ['Недостача по закупочной цене', t.shortageCost],
        ['Недостача по цене продажи', t.shortageSale],
        ['Излишки, ед.', t.surplusQty],
        ['Излишки по закупочной цене', t.surplusCost],
        ['Излишки по цене продажи', t.surplusSale],
      ],
    })
  } else {
    doc.sections.push({
      head: ['Товар', 'Кол-во', 'Цена', 'Сумма'],
      rows: op.items.map((i) => [i.product_name, i.qty, i.price, Math.round(i.qty * i.price * 100) / 100]),
      money: [2, 3],
    })
    const tail: (string | number)[][] = [['Итого', op.total]]
    for (const p of op.payments) tail.push([p.method === 'bank' ? `${p.bank_name}` : PAY_LABEL[p.method], p.amount])
    if (op.supplier) tail.push(['Поставщик', op.supplier])
    if (op.reason) tail.push(['Причина', WRITEOFF_REASONS[op.reason] ?? op.reason])
    if (op.comment) tail.push(['Комментарий', op.comment])
    doc.sections.push({ rows: tail })
  }
  return doc
}

export default function OperationView({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: () => void }) {
  const { backend, profile, shopName } = useStore()
  const toast = useToast()
  const nav = useNavigate()
  const [op, setOp] = useState<Operation | null>(null)
  const [linked, setLinked] = useState<Operation[]>([])
  const [ref, setRef] = useState<Operation | null>(null)
  const [cancelMode, setCancelMode] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const o = await backend.getOperation(id)
      setOp(o)
      if (o) {
        setLinked(await backend.listLinkedOperations(o.id))
        setRef(o.ref_id ? await backend.getOperation(o.ref_id) : null)
      }
    } catch (e) {
      toast.error(errorText(e))
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [id])

  const cancel = async () => {
    if (!op) return
    setBusy(true)
    try {
      await backend.cancelSale(op.id, reason)
      toast.ok('Продажа отменена, товар возвращён на склад')
      setCancelMode(false)
      await load()
      onChanged?.()
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!op) return <Modal title="Операция" onClose={onClose}><div className="muted">Загрузка…</div></Modal>

  const at = op.type === 'audit' ? auditTotals(op) : null
  const hasReturns = linked.some((l) => l.type === 'return' && l.status === 'done')

  return (
    <Modal title={opTitle(op)} onClose={onClose} wide footer={
      <>
        <button className="btn" onClick={() => printDoc(opDoc(op, shopName))}>🖨 Печать / PDF</button>
        {op.type === 'sale' && op.status === 'done' && (
          <button className="btn" onClick={() => nav(`/returns/return?sale=${op.id}`)}>↩️ Возврат</button>
        )}
        {op.type === 'sale' && op.status === 'done' && canManage(profile.role) && !hasReturns && (
          <button className="btn btn-danger" onClick={() => setCancelMode(true)}>Отменить продажу</button>
        )}
      </>
    }>
      <div className="op-meta">
        <div>{dateTime(op.created_at)}{op.user_name ? ` · ${op.user_name}` : ''}</div>
        {op.status === 'cancelled' && <div className="badge red">Продажа отменена</div>}
        {op.supplier && <div>Поставщик: <b>{op.supplier}</b></div>}
        {op.reason && <div>Причина: <b>{WRITEOFF_REASONS[op.reason] ?? op.reason}</b></div>}
        {op.comment && <div>Комментарий: {op.comment}</div>}
        {ref && <div>Основание: {OP_LABEL[ref.type]} №{ref.number} от {dateTime(ref.created_at)}</div>}
      </div>

      {op.type === 'audit' ? (
        <>
          <table className="table">
            <thead><tr><th>Товар</th><th>База</th><th>Факт</th><th>Разн.</th></tr></thead>
            <tbody>
              {op.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.product_name}</td>
                  <td className="n">{num(it.expected_qty)}</td>
                  <td className="n">{num(it.actual_qty)}</td>
                  <td className={'n ' + (it.delta < 0 ? 'red-text' : it.delta > 0 ? 'green-text' : '')}>{it.delta > 0 ? '+' : ''}{num(it.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {at && (
            <div className="kv">
              <div><span>Проверено товаров</span><b>{at.checked}</b></div>
              <div><span>Недостача</span><b className="red-text">{num(at.shortageQty)} ед. · {money(at.shortageCost)}</b></div>
              <div><span>Излишки</span><b className="green-text">{num(at.surplusQty)} ед. · {money(at.surplusCost)}</b></div>
              <div className="muted small">Суммы по закупочной цене. По цене продажи: недостача {money(at.shortageSale)}, излишки {money(at.surplusSale)}</div>
            </div>
          )}
        </>
      ) : (
        <>
          <table className="table">
            <thead><tr><th>Товар</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
            <tbody>
              {op.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.product_name}</td>
                  <td className="n">{num(it.qty)}</td>
                  <td className="n">{money(it.price)}</td>
                  <td className="n">{money(it.qty * it.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="kv">
            <div className="big"><span>Итого</span><b>{money(op.total)}</b></div>
            {op.payments.map((p, i) => (
              <div key={i}><span>{p.method === 'bank' ? `🏦 ${p.bank_name}` : p.method === 'cash' ? '💵 Наличные' : '🟥 Kaspi'}</span><b>{money(p.amount)}</b></div>
            ))}
            {canManage(profile.role) && (op.type === 'sale' || op.type === 'return') && (
              <div className="muted small"><span>Себестоимость: {money(op.cost_total)}</span> · <span>Прибыль: {money(op.total - op.cost_total)}</span></div>
            )}
          </div>
        </>
      )}

      {linked.length > 0 && (
        <div className="linked">
          <div className="section-title">Связанные операции</div>
          {linked.map((l) => (
            <div key={l.id} className="muted">{OP_ICON[l.type]} {OP_LABEL[l.type]} №{l.number} · {dateTime(l.created_at)} · {money(l.total)}</div>
          ))}
        </div>
      )}

      {cancelMode && (
        <Modal title="Отмена продажи" onClose={() => setCancelMode(false)} footer={
          <>
            <button className="btn" onClick={() => setCancelMode(false)}>Назад</button>
            <button className="btn btn-danger" disabled={busy} onClick={cancel}>Отменить продажу</button>
          </>
        }>
          <p>Продажа №{op.number} на {money(op.total)} будет отменена, товары вернутся на склад, сумма уберётся из отчётов.</p>
          <label className="field">
            <span className="field-label">Причина отмены</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Например: ошибка кассира" />
          </label>
        </Modal>
      )}
    </Modal>
  )
}
