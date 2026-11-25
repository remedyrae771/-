import { dateTime } from './format'

export type Cell = string | number | null | undefined

export interface DocSection {
  title?: string
  head?: string[]
  rows: Cell[][]
  /** Колонки, которые являются денежными суммами — для форматирования */
  money?: number[]
}

export interface ReportDoc {
  title: string
  subtitle?: string
  sections: DocSection[]
}

function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80)
}

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export async function saveBlob(blob: Blob, fileName: string) {
  // На iPhone удобнее отправить файл через меню «Поделиться» (WhatsApp, Файлы, Почта)
  if (isIOS() && navigator.canShare) {
    const file = new File([blob], fileName, { type: blob.type })
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: fileName })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Выгрузка в Excel (.xlsx). Каждый раздел — отдельный лист, если sheetPerSection=true */
export async function exportXlsx(doc: ReportDoc, sheetPerSection = false) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  type SheetCell = { value?: string | number; type?: StringConstructor | NumberConstructor; fontWeight?: 'bold'; format?: string; span?: number } | null
  const toRows = (sections: DocSection[], withTitle: boolean): SheetCell[][] => {
    const rows: SheetCell[][] = []
    if (withTitle) {
      rows.push([{ value: doc.title, type: String, fontWeight: 'bold' }])
      if (doc.subtitle) rows.push([{ value: doc.subtitle, type: String }])
      rows.push([null])
    }
    for (const s of sections) {
      if (s.title) rows.push([{ value: s.title, type: String, fontWeight: 'bold' }])
      if (s.head) rows.push(s.head.map((h) => ({ value: h, type: String, fontWeight: 'bold' })))
      for (const r of s.rows) {
        rows.push(r.map((c, i) => {
          if (c == null || c === '') return null
          if (typeof c === 'number') return { value: c, type: Number, format: s.money?.includes(i) ? '#,##0.00' : '#,##0.###' }
          return { value: String(c), type: String }
        }))
      }
      rows.push([null])
    }
    return rows
  }
  const widthOf = (sections: DocSection[]) => {
    const w: number[] = []
    for (const s of sections) {
      for (const r of [s.head ?? [], ...s.rows]) {
        r.forEach((c, i) => { w[i] = Math.min(50, Math.max(w[i] ?? 8, String(c ?? '').length + 2)) })
      }
    }
    return w.map((width) => ({ width }))
  }

  const sheets = sheetPerSection
    ? doc.sections.map((s, i) => ({ sheet: (s.title || `Лист ${i + 1}`).slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), data: toRows([s], i === 0), columns: widthOf([s]) }))
    : [{ sheet: 'Отчёт', data: toRows(doc.sections, true), columns: widthOf(doc.sections) }]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await (writeXlsxFile as any)(sheets, { fontFamily: 'Arial', fontSize: 11 }).toBlob()
  await saveBlob(blob, safeName(doc.title) + '.xlsx')
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

const fmtNum = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })

export function docToHtml(doc: ReportDoc): string {
  let h = `<h1>${esc(doc.title)}</h1>`
  if (doc.subtitle) h += `<div class="sub">${esc(doc.subtitle)}</div>`
  for (const s of doc.sections) {
    if (s.title) h += `<h2>${esc(s.title)}</h2>`
    h += '<table>'
    if (s.head) h += '<thead><tr>' + s.head.map((x) => `<th>${esc(x)}</th>`).join('') + '</tr></thead>'
    h += '<tbody>' + s.rows.map((r) => '<tr>' + r.map((c) =>
      typeof c === 'number' ? `<td class="n">${fmtNum.format(c)}</td>` : `<td>${esc(String(c ?? ''))}</td>`).join('') + '</tr>').join('') + '</tbody>'
    h += '</table>'
  }
  h += `<div class="printed">Сформировано в Store Scan · ${esc(dateTime(new Date().toISOString()))}</div>`
  return h
}

/**
 * PDF: показывается предпросмотр документа и открывается системное окно печати,
 * где можно выбрать «Сохранить как PDF» (на iPhone: «Поделиться» → «Сохранить в Файлы»).
 * Так поддерживаются любые шрифты и кириллица.
 */
export function printDoc(doc: ReportDoc) {
  document.getElementById('print-root')?.remove()
  const root = document.createElement('div')
  root.id = 'print-root'
  root.innerHTML = `<div class="print-toolbar"><button type="button" data-act="close">✕ Закрыть</button>` +
    `<button type="button" data-act="print" class="primary">🖨 Печать / PDF</button></div>` +
    `<div class="print-page">${docToHtml(doc)}</div>`
  document.body.appendChild(root)
  document.body.classList.add('printing')
  const prevTitle = document.title
  const close = () => {
    root.remove()
    document.body.classList.remove('printing')
    document.title = prevTitle
  }
  const print = () => {
    document.title = doc.title
    window.print()
  }
  root.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act
    if (act === 'close') close()
    if (act === 'print') print()
  })
  setTimeout(print, 300)
}
