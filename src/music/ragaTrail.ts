import { ragaPitchAtFrequency, type Raga } from './ragas'

export type TrailPoint = { at: number; frequency: number | null }

export function markOutsideTrail(points: TrailPoint[], raga: Raga | null, saHz: number): boolean[] {
  if (!raga) return points.map(() => false)
  let candidate: { semitone: number; since: number } | null = null
  let previousAt = -Infinity
  return points.map(point => {
    if (point.frequency === null || point.at - previousAt > 250) candidate = null
    previousAt = point.at
    if (point.frequency === null) return false
    const pitch = ragaPitchAtFrequency(point.frequency, saHz, raga)
    if (pitch.allowed || Math.abs(pitch.cents) > 30) { candidate = null; return false }
    if (!candidate || candidate.semitone !== pitch.semitone) candidate = { semitone: pitch.semitone, since: point.at }
    return point.at - candidate.since >= 220
  })
}
