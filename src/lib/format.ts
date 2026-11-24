const moneyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 0 })
const qtyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })

export function money(n: number | null | undefined): string {
  return moneyFmt.format(round2(n ?? 0)).replace(/ /g, ' ') + ' ₸'
}

export function num(n: number | null | undefined): string {
  return qtyFmt.format(n ?? 0).replace(/ /g, ' ')
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}

/** Разбор числа, введённого пользователем: "1 500,5" → 1500.5 */
export function parseNum(s: string | number | null | undefined): number {
  if (typeof s === 'number') return s
  if (!s) return 0
  const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(v) ? v : 0
}

export function dateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function dateOnly(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** Ключ дня в локальном времени: 2026-11-24 */
export function dayKey(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${x.getFullYear()}-${m}-${day}`
}

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function errorText(e: unknown): string {
  if (!e) return 'Неизвестная ошибка'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  const any = e as { message?: string; error_description?: string }
  return any.message || any.error_description || JSON.stringify(e)
}

/** Нормализация текста для поиска */
export function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').trim()
}

/** Склонение: plural(5, ['продажа', 'продажи', 'продаж']) → 'продаж' */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return forms[2]
  if (b > 1 && b < 5) return forms[1]
  if (b === 1) return forms[0]
  return forms[2]
}
