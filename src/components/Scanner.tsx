import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { beep, getDetector } from '../lib/scanner'

export interface ScanFeedback {
  ok: boolean
  title: string
  subtitle?: string
}

interface Props {
  title?: string
  /** Непрерывный режим: камера остаётся открытой для следующего товара */
  continuous?: boolean
  onDetect: (code: string) => ScanFeedback | void | Promise<ScanFeedback | void>
  onClose: () => void
}

export default function Scanner({ title = 'Сканирование', continuous = false, onDetect, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [torch, setTorch] = useState<boolean | null>(null)
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const [flash, setFlash] = useState<{ ok: boolean; n: number } | null>(null)
  const [manual, setManual] = useState('')
  const last = useRef<{ code: string; t: number }>({ code: '', t: 0 })
  const busy = useRef(false)
  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const handle = async (code: string) => {
    const now = Date.now()
    if (code === last.current.code && now - last.current.t < 2000) return
    last.current = { code, t: now }
    busy.current = true
    try {
      const fb = await onDetectRef.current(code)
      beep(fb ? fb.ok : true)
      setFlash({ ok: fb ? fb.ok : true, n: Date.now() })
      if (fb) setFeedback(fb)
      if (!continuous) {
        onCloseRef.current()
        return
      }
    } finally {
      busy.current = false
    }
  }

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Камера недоступна. Откройте приложение по адресу https:// в Safari или Chrome.')
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const video = videoRef.current!
        video.srcObject = stream
        await video.play().catch(() => undefined)
        const track = stream.getVideoTracks()[0]
        const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean; focusMode?: string[] }
        if (caps.torch) setTorch(false)
        if (caps.focusMode?.includes('continuous')) {
          track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined)
        }
        const detector = await getDetector()
        setStarting(false)

        const tick = async () => {
          if (stopped) return
          if (!busy.current && video.readyState >= 2 && video.videoWidth > 0) {
            try {
              const codes = await detector.detect(video)
              const code = codes.find((c) => c.rawValue)?.rawValue
              if (code && !stopped) await handle(code.trim())
            } catch { /* кадр не распознан */ }
          }
          if (!stopped) timer = setTimeout(tick, 120)
        }
        tick()
      } catch (e) {
        setStarting(false)
        const err = e as { name?: string; message?: string }
        if (err?.name === 'NotAllowedError') setError('Нет доступа к камере. Разрешите доступ к камере в настройках браузера и попробуйте снова.')
        else if (err?.name === 'NotFoundError') setError('Камера не найдена.')
        else setError(err?.message || 'Не удалось запустить камеру')
      }
    }
    start()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!feedback) return
    const t = setTimeout(() => setFeedback(null), 3500)
    return () => clearTimeout(t)
  }, [feedback])

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] })
      setTorch(!torch)
    } catch { /* фонарик не поддерживается */ }
  }

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault()
    const code = manual.trim()
    if (!code) return
    setManual('')
    last.current = { code: '', t: 0 }
    handle(code)
  }

  return createPortal(
    <div className="scanner">
      <div className="scanner-top">
        <button className="scanner-btn" onClick={onClose} aria-label="Закрыть">✕</button>
        <div className="scanner-title">{title}</div>
        {torch !== null ? (
          <button className={'scanner-btn' + (torch ? ' on' : '')} onClick={toggleTorch} aria-label="Фонарик">🔦</button>
        ) : <span style={{ width: 48 }} />}
      </div>
      <div className="scanner-view">
        <video ref={videoRef} playsInline muted autoPlay />
        {!error && (
          <div key={flash?.n ?? 0} className={'scanner-frame' + (flash ? (flash.ok ? ' flash-ok' : ' flash-bad') : '')}>
            <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
            <div className="scanner-line" />
          </div>
        )}
        {starting && !error && <div className="scanner-msg">Запуск камеры…</div>}
        {error && <div className="scanner-msg error">{error}</div>}
      </div>
      {feedback && (
        <div key={flash?.n} className={'scanner-feedback ' + (feedback.ok ? 'ok' : 'bad')}>
          <div className="fb-icon">{feedback.ok ? '✓' : '!'}</div>
          <div>
          <div className="fb-title">{feedback.title}</div>
          {feedback.subtitle && <div className="fb-sub">{feedback.subtitle}</div>}
          </div>
        </div>
      )}
      <form className="scanner-bottom" onSubmit={submitManual}>
        <input
          inputMode="numeric"
          placeholder="Ввести штрихкод вручную"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">OK</button>
        {continuous && <button type="button" className="btn" onClick={onClose}>Готово</button>}
      </form>
    </div>,
    document.body,
  )
}
