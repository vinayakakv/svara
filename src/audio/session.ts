import { swaraForFrequency, type PitchMethod } from './pitch'
import { ragaPitchAtFrequency, type Raga } from '../music/ragas'

export type SessionFrame = {
  at: number
  frequency: number | null
  confidence: number | null
  rms: number | null
  method: PitchMethod | null
}

export type SessionData = {
  audio: Blob
  audioName: string
  durationMs: number
  frames: SessionFrame[]
  source: 'mic' | 'file'
}

export function frameIndexAtTime(frames: SessionFrame[], timeMs: number): number {
  let low = 0
  let high = frames.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (frames[middle].at <= timeMs) low = middle + 1
    else high = middle
  }
  const index = low - 1
  return index >= 0 && timeMs - frames[index].at <= 300 ? index : -1
}

export function frameAtTime(frames: SessionFrame[], timeMs: number): SessionFrame | null {
  const index = frameIndexAtTime(frames, timeMs)
  return index < 0 ? null : frames[index]
}

function cell(value: string | number | null) {
  if (value === null) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function pitchCsv(frames: SessionFrame[], saHz: number, raga: Raga | null): string {
  const header = 'time_seconds,f0_hz,confidence,rms,method,sa_hz,svara,cents,raga,in_scale'
  const rows = frames.map(frame => {
    const swara = frame.frequency === null ? null : swaraForFrequency(frame.frequency, saHz)
    const ragaPitch = frame.frequency === null || !raga ? null : ragaPitchAtFrequency(frame.frequency, saHz, raga)
    return [
      (frame.at / 1000).toFixed(3),
      frame.frequency?.toFixed(2) ?? null,
      frame.confidence?.toFixed(3) ?? null,
      frame.rms?.toFixed(5) ?? null,
      frame.method,
      saHz.toFixed(2),
      ragaPitch?.label ?? swara?.name ?? null,
      swara?.cents ?? null,
      raga?.name ?? null,
      ragaPitch ? String(ragaPitch.allowed) : null,
    ].map(cell).join(',')
  })
  return [header, ...rows].join('\r\n') + '\r\n'
}
