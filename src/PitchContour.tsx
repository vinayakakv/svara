import { useMemo, useState } from 'react'
import { SHORT_SWARAS, swaraForFrequency } from './audio/pitch'
import styles from './PitchContour.module.css'

export type PitchPoint = { at: number; frequency: number | null }

type Props = {
  points: PitchPoint[]
  now: number
  saHz: number
  centerSemi: number
  seconds: number
}

const WIDTH = 900
const HEIGHT = 260
const PAD = 10
const SEMITONES = 24
const LABELED_STEPS = new Set([0, 2, 4, 5, 7, 9, 11])

function pitchY(semitones: number, center: number) {
  return PAD + (center + SEMITONES / 2 - semitones) / SEMITONES * (HEIGHT - 2 * PAD)
}

function formatHz(value: number) {
  return value < 100 ? value.toFixed(1) : Math.round(value).toString()
}

export default function PitchContour({ points, now, saHz, centerSemi, seconds }: Props) {
  const [hover, setHover] = useState<PitchPoint | null>(null)
  const start = now - seconds * 1000
  const rows = Array.from({ length: 25 }, (_, index) => centerSemi + 12 - index)
  const visible = points.filter(point => point.at >= start && point.at <= now)

  const segments = useMemo(() => {
    const paths: string[] = []
    let path = ''
    let previous: PitchPoint | null = null
    for (const point of visible) {
      if (point.frequency === null) {
        if (path) paths.push(path)
        path = ''
        previous = null
        continue
      }
      const semi = 12 * Math.log2(point.frequency / saHz)
      if (semi < centerSemi - 12 || semi > centerSemi + 12) {
        if (path) paths.push(path)
        path = ''
        previous = null
        continue
      }
      const x = (point.at - start) / (seconds * 1000) * WIDTH
      const y = pitchY(semi, centerSemi)
      const previousSemi = previous?.frequency ? 12 * Math.log2(previous.frequency / saHz) : semi
      if (previous && (point.at - previous.at > 250 || Math.abs(semi - previousSemi) > 7)) {
        if (path) paths.push(path)
        path = ''
      }
      path += `${path ? ' ' : ''}${x.toFixed(1)},${y.toFixed(1)}`
      previous = point
    }
    if (path) paths.push(path)
    return paths
  }, [visible, start, seconds, saHz, centerSemi])

  const hoverSwara = hover?.frequency ? swaraForFrequency(hover.frequency, saHz) : null

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
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

  return (
    <div className={styles.chart}>
      <div className={styles.axisHeading}>SVARA <span>Hz</span></div>
      <div className={styles.rows} aria-hidden="true">
        {rows.filter(semi => LABELED_STEPS.has(((semi % 12) + 12) % 12)).map(semi => {
          const name = SHORT_SWARAS[((semi % 12) + 12) % 12]
          const octave = Math.floor(semi / 12)
          const hz = saHz * Math.pow(2, semi / 12)
          return <div className={`${styles.row} ${semi % 12 === 0 ? styles.tonic : ''}`} key={semi} style={{ top: `${pitchY(semi, centerSemi) / HEIGHT * 100}%` }}><strong>{name}{octave < 0 ? '↓' : octave > 0 ? '↑' : ''}</strong><span>{formatHz(hz)}</span></div>
        })}
      </div>
      <div className={styles.plot} onPointerMove={onPointerMove} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`Live pitch contour over ${seconds} seconds, with svara rows relative to Sa ${saHz.toFixed(2)} hertz`}>
          {rows.map(semi => <line key={semi} x1="0" x2={WIDTH} y1={pitchY(semi, centerSemi)} y2={pitchY(semi, centerSemi)} className={semi % 12 === 0 ? styles.saLine : semi % 12 === 7 ? styles.paLine : styles.gridLine} />)}
          {[0, .25, .5, .75, 1].map(x => <line key={x} x1={x * WIDTH} x2={x * WIDTH} y1="0" y2={HEIGHT} className={styles.timeLine} />)}
          {segments.map((path, index) => <polyline key={index} points={path} fill="none" className={styles.contour} vectorEffect="non-scaling-stroke" />)}
        </svg>
        {hover && hoverSwara && <div className={styles.tooltip}>{hover.frequency?.toFixed(1)} Hz · {hoverSwara.name} {hoverSwara.cents >= 0 ? '+' : ''}{hoverSwara.cents}¢ · {((hover.at - now) / 1000).toFixed(1)}s</div>}
      </div>
      <div className={styles.timeAxis}><span>−{seconds}s</span><span>−{seconds / 2}s</span><span>Now</span></div>
    </div>
  )
}
