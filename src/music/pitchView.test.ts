import { expect, test } from 'bun:test'
import { clampPitchView, followPitchView, pitchViewBounds } from './pitchView'

test('pitch view pans only through detector range plus one octave', () => {
  const bounds = pitchViewBounds(75, 1000, 261.63)
  const high = clampPitchView(100, 36, 75, 1000, 261.63)
  const low = clampPitchView(-100, 36, 75, 1000, 261.63)
  expect(high.center + high.range / 2).toBeCloseTo(bounds.upper, 8)
  expect(low.center - low.range / 2).toBeCloseTo(bounds.lower, 8)
  expect(clampPitchView(6, 100, 300, 400, 261.63).range).toBeLessThan(36)
})

test('auto-follow moves only near an edge and respects detector bounds', () => {
  const view = { center: 6, range: 36 }
  expect(followPitchView(view, 523.26, 75, 1000, 261.63)).toEqual(view)
  const followed = followPitchView(view, 800, 75, 1000, 261.63)
  expect(followed.center).toBeGreaterThan(view.center)
  const capped = followPitchView(view, 10000, 75, 1000, 261.63)
  const bounds = pitchViewBounds(75, 1000, 261.63)
  expect(capped.center + capped.range / 2).toBeCloseTo(bounds.upper, 8)
})
