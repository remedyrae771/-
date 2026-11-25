import { useState } from 'react'
import { builtInCloud, type Backend } from '../backend'
import { Logo } from '../components/Logo'
import { Field } from '../components/ui'
import { errorText } from '../lib/format'
import { ROLE_LABEL, type Profile } from '../lib/types'

export default function Login({ backend, onDone, onChangeConnection }: {
  backend: Backend; onDone: () => void; onChangeConnection: () => void
}) {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    setBusy(true)
    try {
      if (mode === 'in') await backend.signIn(email, password)
      else {
        if (!name.trim()) throw new Error('Укажите имя')
        await backend.signUp(email, password, name)
      }
      onDone()
    } catch (err) {
      const text = errorText(err)
      setMsg({ ok: /успешно/.test(text), text })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="logo-center"><Logo size={56} /></div>
        <h1>{mode === 'in' ? 'Вход' : 'Регистрация'}</h1>
        {mode === 'up' && (
          <>
            <p className="small muted">Первый зарегистрированный становится владельцем. Остальные сотрудники получают доступ после подтверждения владельцем.</p>
            <Field label="Имя">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Как вас зовут" />
            </Field>
          </>
        )}
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="off" required />
        </Field>
        <Field label="Пароль">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={6} required />
        </Field>
        {msg && <div className={msg.ok ? 'ok-box' : 'error-box'}>{msg.text}</div>}
        <button className="btn btn-primary btn-lg wide" disabled={busy}>{busy ? 'Подождите…' : mode === 'in' ? 'Войти' : 'Зарегистрироваться'}</button>
        <button type="button" className="btn wide" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null) }}>
          {mode === 'in' ? 'Нет аккаунта? Регистрация' : 'Уже есть аккаунт? Войти'}
        </button>
        {!builtInCloud && <button type="button" className="link small" onClick={onChangeConnection}>Изменить подключение к базе</button>}
      </form>
    </div>
  )
}

export function Waiting({ profile, onRefresh, onSignOut }: { profile: Profile; onRefresh: () => void; onSignOut: () => void }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="logo-center"><Logo size={48} /></div>
        <h1>{profile.role === 'blocked' ? 'Доступ закрыт' : 'Ожидание подтверждения'}</h1>
        <p>{profile.name} ({profile.email})</p>
        <p className="muted">
          {profile.role === 'blocked'
            ? 'Владелец магазина заблокировал этот аккаунт.'
            : 'Попросите владельца магазина открыть «Настройки → Сотрудники» и назначить вам роль.'}
        </p>
        <div className="badge orange">{ROLE_LABEL[profile.role]}</div>
        <button className="btn btn-primary btn-lg wide" onClick={onRefresh}>Проверить снова</button>
        <button className="btn wide" onClick={onSignOut}>Выйти</button>
      </div>
    </div>
  )
}
