import { useState } from 'react'
import type { Connection } from '../backend'
import { Field } from '../components/ui'

export default function Setup({ onDone }: { onDone: (c: Connection) => void }) {
  const [cloud, setCloud] = useState(false)
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')

  const connect = () => {
    let u = url.trim().replace(/\/+$/, '')
    if (u && !/^https?:\/\//.test(u)) u = 'https://' + u
    if (!/^https:\/\/.+/.test(u)) return setErr('Укажите адрес проекта, например https://abcd.supabase.co')
    if (key.trim().length < 20) return setErr('Укажите публичный ключ (anon / publishable key)')
    onDone({ mode: 'cloud', url: u, key: key.trim() })
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="logo">🏪</div>
        <h1>Учёт магазина</h1>
        <p className="muted">Товары, продажи, приход, ревизия и касса — прямо с телефона.</p>

        {!cloud ? (
          <>
            <button className="btn btn-primary btn-lg wide" onClick={() => setCloud(true)}>
              ☁️ Подключить облачную базу
            </button>
            <p className="small muted">Общая база для нескольких телефонов, сотрудники, синхронизация остатков.</p>
            <button className="btn btn-lg wide" onClick={() => onDone({ mode: 'local' })}>
              📱 Работать только на этом телефоне
            </button>
            <p className="small muted">Без регистрации. Данные хранятся на этом устройстве — подходит, чтобы попробовать.</p>
          </>
        ) : (
          <>
            <Field label="Адрес проекта (Project URL)">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" autoCapitalize="off" autoCorrect="off" />
            </Field>
            <Field label="Публичный ключ (anon / publishable key)">
              <textarea rows={3} value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJhbGciOi... или sb_publishable_..." autoCapitalize="off" autoCorrect="off" />
            </Field>
            {err && <div className="error-box">{err}</div>}
            <button className="btn btn-primary btn-lg wide" onClick={connect}>Подключить</button>
            <button className="btn wide" onClick={() => setCloud(false)}>Назад</button>
            <p className="small muted">Где взять: Supabase → Project Settings → API. Подробная инструкция — в файле README.</p>
          </>
        )}
      </div>
    </div>
  )
}
