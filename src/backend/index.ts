import { LocalBackend } from './local'
import { SupabaseBackend } from './supabase'
import type { Backend } from './types'

export type Connection =
  | { mode: 'local' }
  | { mode: 'cloud'; url: string; key: string }

const KEY = 'shop-connection'

const ENV_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const ENV_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Адрес базы, «зашитый» при сборке — тогда сотрудникам ничего настраивать не нужно */
export const builtInCloud = !!(ENV_URL && ENV_KEY)

export function loadConnection(): Connection | null {
  if (builtInCloud) return { mode: 'cloud', url: ENV_URL!, key: ENV_KEY! }
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Connection) : null
  } catch {
    return null
  }
}

export function saveConnection(c: Connection | null) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c))
    else localStorage.removeItem(KEY)
  } catch { /* недоступно хранилище */ }
}

export function createBackend(c: Connection): Backend {
  return c.mode === 'cloud'
    ? new SupabaseBackend(c.url.trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/, ''), c.key.trim())
    : new LocalBackend()
}

export type { Backend }
