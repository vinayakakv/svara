export type PitchView = { center: number; range: number }

const MIN_RANGE = 12
const MAX_RANGE = 60
const MARGIN = 12

export function pitchViewBounds(minHz: number, maxHz: number, saHz: number) {
  return {
    lower: 12 * Math.log2(minHz / saHz) - MARGIN,
    upper: 12 * Math.log2(maxHz / saHz) + MARGIN,
  }
}

export function clampPitchView(center: number, range: number, minHz: number, maxHz: number, saHz: number): PitchView {
  const bounds = pitchViewBounds(minHz, maxHz, saHz)
  const span = bounds.upper - bounds.lower
  const nextRange = Math.min(Math.max(range, MIN_RANGE), MAX_RANGE, span)
  const nextCenter = Math.max(bounds.lower + nextRange / 2, Math.min(bounds.upper - nextRange / 2, center))
  return { center: nextCenter, range: nextRange }
}

export function followPitchView(view: PitchView, frequency: number, minHz: number, maxHz: number, saHz: number): PitchView {
  const pitch = 12 * Math.log2(frequency / saHz)
  const upperTrigger = view.center + view.range * 0.35
  const lowerTrigger = view.center - view.range * 0.35
  const nextCenter = pitch > upperTrigger ? pitch - view.range * 0.3
    : pitch < lowerTrigger ? pitch + view.range * 0.3
      : view.center
  return clampPitchView(nextCenter, view.range, minHz, maxHz, saHz)
}
