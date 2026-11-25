import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

/** Минимальный интерфейс детектора, общий для встроенного BarcodeDetector и wasm-версии */
export interface Detector {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code', 'data_matrix']

let detectorPromise: Promise<Detector> | null = null

/**
 * Встроенный в браузер сканер (Android Chrome) работает быстрее всего.
 * На iPhone его нет — используется библиотека ZXing (WebAssembly), файл которой
 * входит в состав приложения и работает без интернета.
 */
export function getDetector(): Promise<Detector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const Native = (globalThis as unknown as { BarcodeDetector?: { new (o: unknown): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector
      if (Native) {
        try {
          const supported = await Native.getSupportedFormats()
          const formats = FORMATS.filter((f) => supported.includes(f))
          if (formats.includes('ean_13')) return new Native({ formats })
        } catch { /* используем wasm */ }
      }
      const mod = await import('barcode-detector/ponyfill')
      mod.setZXingModuleOverrides({
        locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
      })
      return new mod.BarcodeDetector({ formats: FORMATS as never }) as unknown as Detector
    })()
    detectorPromise.catch(() => { detectorPromise = null })
  }
  return detectorPromise
}

let audioCtx: AudioContext | null = null

/** Короткий звуковой сигнал и вибрация при успешном сканировании */
export function beep(ok = true) {
  try {
    if (navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80])
    audioCtx ??= new AudioContext()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.frequency.value = ok ? 1500 : 400
    g.gain.value = 0.15
    o.connect(g)
    g.connect(audioCtx.destination)
    o.start()
    o.stop(audioCtx.currentTime + (ok ? 0.09 : 0.25))
  } catch { /* звук недоступен */ }
}
