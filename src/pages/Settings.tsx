import { useEffect, useState } from 'react'
import { builtInCloud, type Connection } from '../backend'
import { Field, Page, useConfirm } from '../components/ui'
import { exportXlsx, saveBlob } from '../lib/export'
import { dateTime, errorText, parseNum, round2 } from '../lib/format'
import { useStore, useToast } from '../lib/store'
import { canManage, OP_LABEL, ROLE_LABEL, type BackupData, type Profile, type Role } from '../lib/types'

export default function Settings({ onChangeConnection }: { onChangeConnection: (c: Connection | null) => void }) {
  const { profile, backend, signOut, shopName } = useStore()
  const confirm = useConfirm()
  const manager = canManage(profile.role)
  const owner = profile.role === 'owner'

  return (
    <Page title="Настройки">
      <section className="card">
        <div className="section-title">Аккаунт</div>
        <div className="kv">
          <div><span>Пользователь</span><b>{profile.name}</b></div>
          {profile.email && <div><span>Email</span><b>{profile.email}</b></div>}
          <div><span>Роль</span><b>{ROLE_LABEL[profile.role]}</b></div>
          <div><span>База данных</span><b>{backend.mode === 'cloud' ? '☁️ Облачная (общая)' : '📱 Только этот телефон'}</b></div>
        </div>
        {backend.mode === 'cloud' && <button className="btn wide" onClick={signOut}>Выйти из аккаунта</button>}
      </section>

      {owner && <ShopName current={shopName} />}
      {owner && backend.mode === 'cloud' && <Staff />}
      {manager && <Categories />}
      {manager && <Banks />}
      {manager && <ImportProducts />}
      {manager && <Backup />}

      <section className="card">
        <div className="section-title">Установка на телефон</div>
        <p className="small"><b>iPhone (Safari):</b> кнопка «Поделиться» ⬆️ → «На экран „Домой“».</p>
        <p className="small"><b>Android (Chrome):</b> меню ⋮ → «Установить приложение» / «Добавить на главный экран».</p>
        <p className="small muted">После установки приложение открывается с иконки, как обычное, и работает на весь экран.</p>
      </section>

      {!builtInCloud && (
        <section className="card">
          <div className="section-title">Подключение</div>
          {backend.mode === 'local' && <p className="small muted">Чтобы работать с нескольких телефонов, подключите облачную базу. Данные этого телефона можно сохранить в резервную копию.</p>}
          <button className="btn wide" onClick={async () => {
            if (await confirm.ask('Сменить подключение к базе данных? Данные не удаляются.')) {
              if (backend.mode === 'cloud') await backend.signOut()
              onChangeConnection(null)
            }
          }}>Сменить базу данных</button>
        </section>
      )}
      <div className="muted small center pad">Учёт магазина · версия 1.0</div>
      {confirm.node}
    </Page>
  )
}

function ShopName({ current }: { current: string }) {
  const { backend, reloadRefs } = useStore()
  const toast = useToast()
  const [name, setName] = useState(current)
  return (
    <section className="card">
      <div className="section-title">Магазин</div>
      <Field label="Название магазина">
        <div className="input-with-btn">
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={async () => {
            try { await backend.setSetting('shop_name', name.trim()); await reloadRefs(); toast.ok('Сохранено') } catch (e) { toast.error(errorText(e)) }
          }}>OK</button>
        </div>
      </Field>
    </section>
  )
}

const ROLE_HELP: Record<string, string> = {
  owner: 'всё, включая сотрудников и настройки',
  manager: 'товары, приход, ревизия, списания, отмена продаж, все отчёты',
  cashier: 'продажа, возвраты, просмотр товаров, отчёт за сегодня',
  pending: 'нет доступа, ждёт подтверждения',
  blocked: 'нет доступа',
}

function Staff() {
  const { backend, profile } = useStore()
  const toast = useToast()
  const [list, setList] = useState<Profile[]>([])
  const load = () => backend.listStaff().then(setList).catch((e) => toast.error(errorText(e)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [backend])

  return (
    <section className="card">
      <div className="section-title">Сотрудники</div>
      <p className="small muted">
        Чтобы добавить сотрудника: он открывает это приложение на своём телефоне и нажимает «Регистрация».
        Затем здесь назначьте ему роль.
      </p>
      {list.map((s) => (
        <div key={s.id} className="staff-row">
          <div>
            <b>{s.name}</b>{s.id === profile.id && ' (вы)'}
            <div className="muted small">{s.email} · с {dateTime(s.created_at)}</div>
          </div>
          <select value={s.role} className={s.role === 'pending' ? 'attention' : ''} onChange={async (e) => {
            try { await backend.setStaffRole(s.id, e.target.value as Role); toast.ok('Роль изменена'); load() } catch (err) { toast.error(errorText(err)) }
          }}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>
      ))}
      <div className="small muted">
        {(['owner', 'manager', 'cashier'] as Role[]).map((r) => <div key={r}><b>{ROLE_LABEL[r]}:</b> {ROLE_HELP[r]}</div>)}
      </div>
    </section>
  )
}

function Categories() {
  const { backend, categories, reloadRefs } = useStore()
  const toast = useToast()
  const confirm = useConfirm()
  const [name, setName] = useState('')
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); await reloadRefs() } catch (e) { toast.error(errorText(e)) } }
  return (
    <section className="card">
      <div className="section-title">Категории товаров</div>
      {categories.map((c) => (
        <div key={c.id} className="ref-row">
          <span>{c.name}</span>
          <span className="row-gap">
            <button className="link" onClick={() => { const n = prompt('Новое название', c.name); if (n) run(() => backend.saveCategory({ id: c.id, name: n })) }}>Изменить</button>
            <button className="link danger" onClick={async () => { if (await confirm.ask(`Удалить категорию «${c.name}»? Товары останутся без категории.`, { danger: true })) run(() => backend.deleteCategory(c.id)) }}>Удалить</button>
          </span>
        </div>
      ))}
      <div className="input-with-btn">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Новая категория" />
        <button className="btn" onClick={() => { if (name.trim()) run(async () => { await backend.saveCategory({ name }); setName('') }) }}>Добавить</button>
      </div>
      {confirm.node}
    </section>
  )
}

function Banks() {
  const { backend, banks, reloadRefs } = useStore()
  const toast = useToast()
  const [name, setName] = useState('')
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); await reloadRefs() } catch (e) { toast.error(errorText(e)) } }
  return (
    <section className="card">
      <div className="section-title">Банки для оплаты «Другой банк»</div>
      {banks.map((b) => (
        <div key={b.id} className="ref-row">
          <span>{b.name}</span>
          <button className="link danger" onClick={() => run(() => backend.deleteBank(b.id))}>Удалить</button>
        </div>
      ))}
      <div className="input-with-btn">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название банка" />
        <button className="btn" onClick={() => { if (name.trim()) run(async () => { await backend.saveBank({ name }); setName('') }) }}>Добавить</button>
      </div>
    </section>
  )
}

const IMPORT_HEAD = ['Название', 'Штрихкод', 'Категория', 'Закупочная цена', 'Цена продажи', 'Количество', 'Единица']

function ImportProducts() {
  const { backend, products, categories, reload } = useStore()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')

  const template = () => exportXlsx({
    title: 'Шаблон импорта товаров',
    sections: [{ head: IMPORT_HEAD, rows: [['Молоко 3,2% 1 л', '4870000000001', 'Молочные продукты', 350, 480, 24, 'шт']] }],
  }, true).catch((e) => toast.error(errorText(e)))

  const onFile = async (file: File) => {
    setBusy(true)
    setLog('')
    try {
      const { readSheet } = await import('read-excel-file/browser')
      const rows = await readSheet(file)
      const headIdx = rows.findIndex((r) => r.some((c) => String(c ?? '').toLowerCase().startsWith('название')))
      if (headIdx < 0) throw new Error('Не найдена строка заголовков (столбец «Название»)')
      const head = rows[headIdx].map((c) => String(c ?? '').toLowerCase())
      const col = (name: string) => head.findIndex((h) => h.startsWith(name.toLowerCase()))
      const ci = { name: col('название'), barcode: col('штрихкод'), cat: col('категория'), buy: col('закуп'), sale: col('цена продажи'), qty: col('количество'), unit: col('единица') }

      const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]))
      const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [p.barcode!, p]))
      const byName = new Map(products.map((p) => [p.name.toLowerCase(), p]))
      const receipt: { product_id: string; qty: number; price: number }[] = []
      let created = 0, updated = 0, skipped = 0

      for (const r of rows.slice(headIdx + 1)) {
        const name = String(r[ci.name] ?? '').trim()
        if (!name) { skipped++; continue }
        const barcode = ci.barcode >= 0 && r[ci.barcode] != null ? String(r[ci.barcode]).trim().replace(/\.0+$/, '') : ''
        const catName = ci.cat >= 0 ? String(r[ci.cat] ?? '').trim() : ''
        let catId: string | null = null
        if (catName) {
          catId = catByName.get(catName.toLowerCase()) ?? null
          if (!catId) {
            const c = await backend.saveCategory({ name: catName })
            catId = c.id
            catByName.set(catName.toLowerCase(), c.id)
          }
        }
        const existing = (barcode && byBarcode.get(barcode)) || byName.get(name.toLowerCase())
        const buy = ci.buy >= 0 ? round2(parseNum(r[ci.buy] as string)) : existing?.purchase_price ?? 0
        const sale = ci.sale >= 0 ? round2(parseNum(r[ci.sale] as string)) : existing?.sale_price ?? 0
        const unit = ci.unit >= 0 && r[ci.unit] ? String(r[ci.unit]) : existing?.unit ?? 'шт'
        const p = await backend.saveProduct({
          id: existing?.id, name, barcode: barcode || existing?.barcode || null, category_id: catId ?? existing?.category_id ?? null,
          purchase_price: buy, sale_price: sale, unit,
        })
        if (existing) updated++; else created++
        const qty = ci.qty >= 0 ? parseNum(r[ci.qty] as string) : 0
        if (qty > 0) receipt.push({ product_id: p.id, qty, price: buy })
      }
      if (receipt.length) await backend.postOperation({ type: 'receipt', items: receipt, comment: 'Импорт из Excel' })
      await reload()
      setLog(`Готово: создано ${created}, обновлено ${updated}${skipped ? `, пропущено пустых строк ${skipped}` : ''}${receipt.length ? `, оформлен приход на ${receipt.length} поз.` : ''}`)
    } catch (e) {
      setLog('Ошибка: ' + errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="section-title">Импорт товаров из Excel</div>
      <p className="small muted">Столбцы: {IMPORT_HEAD.join(', ')}. Товары с существующим штрихкодом обновляются, количество оформляется приходом.</p>
      <div className="row-gap">
        <button className="btn" onClick={template}>Скачать шаблон</button>
        <label className="btn btn-primary">
          {busy ? 'Загрузка…' : 'Выбрать файл .xlsx'}
          <input type="file" accept=".xlsx" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
        </label>
      </div>
      {log && <div className="notice small">{log}</div>}
    </section>
  )
}

function Backup() {
  const { backend, reload, reloadRefs } = useStore()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')

  const json = async () => {
    setBusy(true)
    try {
      const data = await backend.exportBackup()
      await saveBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `backup-${stamp()}.json`)
    } catch (e) { toast.error(errorText(e)) } finally { setBusy(false) }
  }

  const excel = async () => {
    setBusy(true)
    try {
      const d = await backend.exportBackup()
      const cat = new Map(d.categories.map((c) => [c.id, c.name]))
      await exportXlsx({
        title: `Полная выгрузка ${stamp()}`,
        sections: [
          { title: 'Товары', head: ['Название', 'Штрихкод', 'Категория', 'Ед.', 'Остаток', 'Закуп. цена', 'Цена продажи', 'Архив'],
            rows: d.products.map((p) => [p.name, p.barcode ?? '', cat.get(p.category_id ?? '') ?? '', p.unit, p.stock, p.purchase_price, p.sale_price, p.archived ? 'да' : '']) },
          { title: 'Операции', head: ['№', 'Дата', 'Тип', 'Статус', 'Сотрудник', 'Сумма', 'Себестоимость', 'Оплата', 'Комментарий'],
            rows: d.operations.map((o) => [o.number, dateTime(o.created_at), OP_LABEL[o.type], o.status === 'cancelled' ? 'отменена' : '', o.user_name ?? '', o.total, o.cost_total,
              o.payments.map((p) => `${p.method === 'bank' ? p.bank_name : p.method}: ${p.amount}`).join('; '), o.comment ?? '']) },
          { title: 'Строки операций', head: ['№ операции', 'Тип', 'Товар', 'Кол-во', 'Изменение остатка', 'Цена', 'Себестоимость', 'По базе', 'Факт'],
            rows: d.operations.flatMap((o) => o.items.map((i) => [o.number, OP_LABEL[o.type], i.product_name, i.qty, i.delta, i.price, i.cost, i.expected_qty ?? '', i.actual_qty ?? ''])) },
        ],
      }, true)
    } catch (e) { toast.error(errorText(e)) } finally { setBusy(false) }
  }

  const restore = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as BackupData
      if (!(await confirm.ask(`Восстановить данные из копии от ${dateTime(data.created_at)}?\nТекущие данные на этом телефоне будут заменены.`, { danger: true, ok: 'Восстановить' }))) return
      await backend.importBackup!(data)
      await reloadRefs()
      await reload()
      toast.ok('Данные восстановлены')
    } catch (e) { toast.error(errorText(e)) }
  }

  return (
    <section className="card">
      <div className="section-title">Резервное копирование</div>
      {backend.mode === 'cloud'
        ? <p className="small muted">Облачная база сохраняет каждую операцию сразу. Дополнительно можно скачать копию всех данных.</p>
        : <p className="small muted">Данные хранятся только на этом телефоне. Регулярно сохраняйте резервную копию!</p>}
      <div className="row-gap">
        <button className="btn" disabled={busy} onClick={json}>💾 Копия (JSON)</button>
        <button className="btn" disabled={busy} onClick={excel}>⬇️ Всё в Excel</button>
        {backend.importBackup && (
          <label className="btn">
            ♻️ Восстановить
            <input type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = '' }} />
          </label>
        )}
      </div>
      {confirm.node}
    </section>
  )
}
