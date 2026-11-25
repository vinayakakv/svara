import { useEffect, useMemo, useRef, useState } from 'react'
import { SHORT_SWARAS, swaraForFrequency } from './audio/pitch'
import { ragaSwaraAtClass, type Raga } from './music/ragas'
import { markOutsideTrail, type TrailPoint } from './music/ragaTrail'
import styles from './PitchContour.module.css'

export type PitchPoint = TrailPoint

type Props = {
  points: PitchPoint[]
  now: number
  saHz: number
  centerSemi: number
  rangeSemis: number
  onViewChange: (centerSemi: number, rangeSemis: number) => void
  seconds: number
  raga: Raga | null
}

const WIDTH = 900
const HEIGHT = 260
const PAD = 10
const LABELED_STEPS = new Set([0, 2, 4, 5, 7, 9, 11])

function pitchY(semitones: number, center: number, range: number) {
  return PAD + (center + range / 2 - semitones) / range * (HEIGHT - 2 * PAD)
}

function clampRange(value: number) { return Math.max(12, Math.min(60, value)) }

function formatHz(value: number) {
  return value < 100 ? value.toFixed(1) : Math.round(value).toString()
}

export default function PitchContour({ points, now, saHz, centerSemi, rangeSemis, onViewChange, seconds, raga }: Props) {
  const [hover, setHover] = useState<PitchPoint | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef({ centerSemi, rangeSemis, onViewChange })
  viewRef.current = { centerSemi, rangeSemis, onViewChange }
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ center: number; range: number; y: number; distance: number; anchor: number } | null>(null)
  const start = now - seconds * 1000
  const upper = Math.floor(centerSemi + rangeSemis / 2)
  const lower = Math.ceil(centerSemi - rangeSemis / 2)
  const rows = Array.from({ length: upper - lower + 1 }, (_, index) => upper - index)
  const labeledRows = rows.filter(semi => {
    const pitchClass = ((semi % 12) + 12) % 12
    if (rangeSemis > 42) return pitchClass === 0 || pitchClass === 7
    if (rangeSemis > 28) return [0, 2, 5, 7, 9].includes(pitchClass)
    return LABELED_STEPS.has(pitchClass) || Boolean(raga?.pitchClasses.includes(pitchClass))
  })
  const marked = useMemo(() => {
    const outside = markOutsideTrail(points, raga, saHz)
    return points.map((point, index) => ({ ...point, outside: outside[index] }))
  }, [points, raga, saHz])
  const visible = marked.filter(point => point.at >= start && point.at <= now)

  const segments = useMemo(() => {
    const paths: { points: string; outside: boolean }[] = []
    let path = ''
    let outside = false
    let previous: PitchPoint | null = null
    for (const point of visible) {
      if (point.frequency === null) {
        if (path) paths.push({ points: path, outside })
        path = ''
        previous = null
        continue
      }
      const semi = 12 * Math.log2(point.frequency / saHz)
      if (semi < centerSemi - rangeSemis / 2 || semi > centerSemi + rangeSemis / 2) {
        if (path) paths.push({ points: path, outside })
        path = ''
        previous = null
        continue
      }
      const x = (point.at - start) / (seconds * 1000) * WIDTH
      const y = pitchY(semi, centerSemi, rangeSemis)
      const previousSemi = previous?.frequency ? 12 * Math.log2(previous.frequency / saHz) : semi
      if (previous && (point.at - previous.at > 250 || Math.abs(semi - previousSemi) > 7)) {
        if (path) paths.push({ points: path, outside })
        path = ''
      }
      if (path && outside !== Boolean(point.outside)) {
        paths.push({ points: path, outside })
        path = ''
      }
      outside = Boolean(point.outside)
      path += `${path ? ' ' : ''}${x.toFixed(1)},${y.toFixed(1)}`
      previous = point
    }
    if (path) paths.push({ points: path, outside })
    return paths
  }, [visible, start, seconds, saHz, centerSemi, rangeSemis])

  const hoverSwara = hover?.frequency ? swaraForFrequency(hover.frequency, saHz) : null
  const hoverRagaSwara = hover?.frequency && raga ? ragaSwaraAtClass(raga, Math.round(12 * Math.log2(hover.frequency / saHz))) : null

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(event.pointerId)) {
      const rect = event.currentTarget.getBoundingClientRect()
      pointers.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top })
      const active = [...pointers.current.values()]
      const initial = gesture.current
      if (initial) {
        if (active.length === 1) onViewChange(initial.center + (active[0].y - initial.y) / rect.height * initial.range, initial.range)
        if (active.length === 2) {
          const distance = Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y)
          const range = clampRange(initial.range * initial.distance / Math.max(10, distance))
          const middleY = (active[0].y + active[1].y) / 2
          onViewChange(initial.anchor - (0.5 - middleY / rect.height) * range, range)
        }
      }
      setHover(null)
      return
    }
    if (event.pointerType !== 'mouse') return
    const rect = event.currentTarget.getBoundingClientRect()
    const time = start + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * seconds * 1000
    let closest: PitchPoint | null = null
    let distance = Infinity
    for (const point of visible) {
      if (point.frequency === null) continue
      const next = Math.abs(point.at - time)
      if (next < distance) { distance = next; closest = point }
    }
    setHover(distance < 260 ? closest : null)
  }

  const beginGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    pointers.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top })
    event.currentTarget.setPointerCapture(event.pointerId)
    const active = [...pointers.current.values()]
    const y = active.reduce((total, point) => total + point.y, 0) / active.length
    const distance = active.length === 2 ? Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y) : 1
    gesture.current = { center: centerSemi, range: rangeSemis, y, distance, anchor: centerSemi + (0.5 - y / rect.height) * rangeSemis }
    setHover(null)
  }

  const endGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    const active = [...pointers.current.values()]
    if (!active.length) { gesture.current = null; return }
    const rect = event.currentTarget.getBoundingClientRect()
    const y = active.reduce((total, point) => total + point.y, 0) / active.length
    gesture.current = { center: centerSemi, range: rangeSemis, y, distance: 1, anchor: centerSemi + (0.5 - y / rect.height) * rangeSemis }
  }

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const { centerSemi, rangeSemis, onViewChange } = viewRef.current
      const rect = plot.getBoundingClientRect()
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
      const anchor = centerSemi + (0.5 - y) * rangeSemis
      const range = clampRange(rangeSemis * Math.exp(event.deltaY * 0.0015))
      onViewChange(anchor - (0.5 - y) * range, range)
    }
    plot.addEventListener('wheel', onWheel, { passive: false })
    return () => plot.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div className={styles.chart}>
      <div className={styles.axisHeading}>SVARA <span>Hz</span></div>
      <div className={styles.rows} aria-hidden="true">
        {labeledRows.map(semi => {
          const pitchClass = ((semi % 12) + 12) % 12
          const allowed = !raga || raga.pitchClasses.includes(pitchClass)
          const name = raga ? ragaSwaraAtClass(raga, pitchClass) ?? SHORT_SWARAS[pitchClass] : SHORT_SWARAS[pitchClass]
          const octave = Math.floor(semi / 12)
          const hz = saHz * Math.pow(2, semi / 12)
          return <div className={`${styles.row} ${semi % 12 === 0 ? styles.tonic : ''} ${!allowed ? styles.forbiddenRow : ''}`} key={semi} style={{ top: `${pitchY(semi, centerSemi, rangeSemis) / HEIGHT * 100}%` }}><strong>{name}{octave < 0 ? '↓' : octave > 0 ? '↑' : ''}{!allowed ? ' ×' : ''}</strong><span>{formatHz(hz)}</span></div>
        })}
      </div>
      <div ref={plotRef} className={styles.plot} onPointerDown={beginGesture} onPointerMove={onPointerMove} onPointerUp={endGesture} onPointerCancel={endGesture} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`Live pitch contour over ${seconds} seconds, with svara rows relative to Sa ${saHz.toFixed(2)} hertz${raga ? ` and pitches outside ${raga.name} marked` : ''}`}>
          {rows.map(semi => <line key={semi} x1="0" x2={WIDTH} y1={pitchY(semi, centerSemi, rangeSemis)} y2={pitchY(semi, centerSemi, rangeSemis)} className={raga && !raga.pitchClasses.includes(((semi % 12) + 12) % 12) ? styles.forbiddenLine : semi % 12 === 0 ? styles.saLine : semi % 12 === 7 ? styles.paLine : styles.gridLine} />)}
          {[0, .25, .5, .75, 1].map(x => <line key={x} x1={x * WIDTH} x2={x * WIDTH} y1="0" y2={HEIGHT} className={styles.timeLine} />)}
          {segments.map((segment, index) => <polyline key={index} points={segment.points} fill="none" className={segment.outside ? styles.outsideContour : styles.contour} vectorEffect="non-scaling-stroke" />)}
        </svg>
        {hover && hoverSwara && <div className={styles.tooltip}>{hover.frequency?.toFixed(1)} Hz · {hoverRagaSwara ?? hoverSwara.name} {hoverSwara.cents >= 0 ? '+' : ''}{hoverSwara.cents}¢ · {((hover.at - now) / 1000).toFixed(1)}s</div>}
      </div>
      <div className={styles.timeAxis}><span>−{seconds}s</span><span>−{seconds / 2}s</span><span>Now</span></div>
    </div>
  )
}
