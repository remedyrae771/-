import { useEffect, useState } from 'react'
import OperationView from '../components/OperationView'
import { Empty, Page } from '../components/ui'
import { addDays, dateOnly, dayKey, errorText, startOfDay } from '../lib/format'
import { useStore, useToast } from '../lib/store'
import { canManage, OP_LABEL, type Operation, type OpType } from '../lib/types'
import { OpRow } from './Reports'

export default function History() {
  const { backend, profile } = useStore()
  const toast = useToast()
  const manager = canManage(profile.role)
  const [days, setDays] = useState(manager ? 7 : 1)
  const [type, setType] = useState<OpType | 'all'>('all')
  const [q, setQ] = useState('')
  const [ops, setOps] = useState<Operation[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [key, setKey] = useState(0)

  useEffect(() => {
    setOps(null)
    const from = days > 0 ? addDays(startOfDay(new Date()), -(days - 1)).toISOString() : undefined
    backend.listOperations({ from, types: type === 'all' ? undefined : [type] }).then(setOps).catch((e) => toast.error(errorText(e)))
  }, [backend, days, type, key, toast])

  const list = (ops ?? []).filter((o) => !q.trim() || String(o.number) === q.trim() ||
    o.items.some((i) => i.product_name.toLowerCase().includes(q.trim().toLowerCase())))

  // группировка по дням
  const groups: [string, Operation[]][] = []
  for (const o of list.slice(0, 1000)) {
    const k = dayKey(o.created_at)
    if (!groups.length || groups[groups.length - 1][0] !== k) groups.push([k, []])
    groups[groups.length - 1][1].push(o)
  }

  return (
    <Page title="История операций">
      <div className="grid2">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>Сегодня</option>
          {manager && <option value={7}>7 дней</option>}
          {manager && <option value={30}>30 дней</option>}
          {manager && <option value={90}>90 дней</option>}
          {manager && <option value={0}>Всё время</option>}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as OpType | 'all')}>
          <option value="all">Все операции</option>
          {(Object.keys(OP_LABEL) as OpType[]).map((t) => <option key={t} value={t}>{OP_LABEL[t]}</option>)}
        </select>
      </div>
      <input type="search" className="search-input" placeholder="Номер операции или товар" value={q} onChange={(e) => setQ(e.target.value)} />
      {!ops ? <div className="muted pad">Загрузка…</div> : !list.length ? <Empty icon="🕘" text="Операций не найдено" /> : (
        groups.map(([day, items]) => (
          <div key={day}>
            <div className="section-title">{dateOnly(day + 'T00:00:00')}</div>
            <div className="list">{items.map((o) => <OpRow key={o.id} o={o} onClick={() => setOpen(o.id)} />)}</div>
          </div>
        ))
      )}
      {open && <OperationView id={open} onClose={() => setOpen(null)} onChanged={() => setKey((k) => k + 1)} />}
    </Page>
  )
}
