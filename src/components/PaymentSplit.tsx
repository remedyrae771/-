import { useState } from 'react'
import { money, round2 } from '../lib/format'
import { useStore } from '../lib/store'
import { PAY_LABEL, type PayMethod, type Payment } from '../lib/types'
import { NumInput } from './ui'

export function paymentsSum(list: Payment[]) {
  return round2(list.reduce((s, p) => s + (p.amount || 0), 0))
}

export function paymentsValid(list: Payment[], total: number) {
  const active = list.filter((p) => p.amount > 0)
  return active.length > 0 && Math.abs(paymentsSum(active) - round2(total)) < 0.01 && active.every((p) => p.method !== 'bank' || !!p.bank_name)
}

/** Оплата одной покупки одним или несколькими способами */
export default function PaymentSplit({ total, value, onChange, refund }: {
  total: number; value: Payment[]; onChange: (v: Payment[]) => void; refund?: boolean
}) {
  const { banks } = useStore()
  const [cashGiven, setCashGiven] = useState<number | null>(null)
  const paid = paymentsSum(value)
  const left = round2(total - paid)
  const single = value.length === 1
  const defaultBank = banks[0]?.name ?? ''

  const setOne = (method: PayMethod) => {
    onChange([{ method, amount: round2(total), bank_name: method === 'bank' ? (value.find((p) => p.method === 'bank')?.bank_name || defaultBank) : null }])
  }
  const update = (i: number, patch: Partial<Payment>) => onChange(value.map((p, j) => (i === j ? { ...p, ...patch } : p)))
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i))
  const add = (method: PayMethod) => onChange([...value, { method, amount: Math.max(0, left), bank_name: method === 'bank' ? defaultBank : null }])
  const split = () => {
    const methods: PayMethod[] = ['cash', 'kaspi', 'bank']
    const existing = value.filter((p) => p.amount > 0)
    const rows = [...existing]
    for (const m of methods) if (!rows.some((r) => r.method === m)) rows.push({ method: m, amount: 0, bank_name: m === 'bank' ? defaultBank : null })
    onChange(rows)
  }

  const cash = value.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0)
  const change = cashGiven != null && cashGiven > 0 ? round2(cashGiven - cash) : null

  return (
    <div className="pay">
      <div className="pay-total">
        <span>{refund ? 'К возврату' : 'К оплате'}</span>
        <b>{money(total)}</b>
      </div>

      <div className="pay-quick">
        {(['cash', 'kaspi', 'bank'] as PayMethod[]).map((m) => (
          <button key={m} type="button"
            className={'pay-btn pay-' + m + (single && value[0].method === m ? ' active' : '')}
            onClick={() => setOne(m)}>
            <span className="pay-ico">{m === 'cash' ? '💵' : m === 'kaspi' ? '🟥' : '🏦'}</span>
            {PAY_LABEL[m]}
          </button>
        ))}
      </div>

      {value.map((p, i) => (
        <div key={i} className={'pay-row pay-row-' + p.method}>
          <div className="pay-row-head">
            <b>{PAY_LABEL[p.method]}</b>
            {!single && <button type="button" className="link danger" onClick={() => remove(i)}>Убрать</button>}
          </div>
          {p.method === 'bank' && (
            <select value={p.bank_name ?? ''} onChange={(e) => update(i, { bank_name: e.target.value })}>
              <option value="">— выберите банк —</option>
              {banks.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
              {p.bank_name && !banks.some((b) => b.name === p.bank_name) && <option value={p.bank_name}>{p.bank_name}</option>}
            </select>
          )}
          <div className="pay-row-amount">
            <NumInput value={p.amount} onChange={(v) => update(i, { amount: v })} />
            <span className="cur">₸</span>
            {!single && left > 0 && (
              <button type="button" className="btn btn-sm" onClick={() => update(i, { amount: round2(p.amount + left) })}>+ остаток</button>
            )}
          </div>
        </div>
      ))}

      <div className="pay-actions">
        {single ? (
          <button type="button" className="btn btn-outline wide" onClick={split}>➗ Разделить оплату на несколько способов</button>
        ) : (
          <>
            <button type="button" className="btn btn-sm" onClick={() => add('cash')}>+ Наличные</button>
            <button type="button" className="btn btn-sm" onClick={() => add('kaspi')}>+ Kaspi</button>
            <button type="button" className="btn btn-sm" onClick={() => add('bank')}>+ Банк</button>
          </>
        )}
      </div>

      <div className={'pay-check ' + (Math.abs(left) < 0.01 ? 'ok' : 'bad')}>
        <div><span>Внесено</span><b>{money(paid)}</b></div>
        {Math.abs(left) < 0.01 ? (
          <div className="ok-text">✓ Сумма совпадает</div>
        ) : left > 0 ? (
          <div><span>Осталось распределить</span><b>{money(left)}</b></div>
        ) : (
          <div><span>Больше суммы на</span><b>{money(-left)}</b></div>
        )}
      </div>

      {!refund && cash > 0 && (
        <div className="change-calc">
          <span>Получено наличными</span>
          <NumInput value={cashGiven} onChange={setCashGiven} placeholder={String(cash)} />
          {change != null && <b className={change < 0 ? 'red-text' : ''}>Сдача: {money(change)}</b>}
        </div>
      )}
    </div>
  )
}
