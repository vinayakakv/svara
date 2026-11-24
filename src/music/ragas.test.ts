import { expect, test } from 'bun:test'
import { JANYA_RAGAS, MELAKARTA_RAGAS, ragaPitchAtFrequency, ragaSwaraAtClass } from './ragas'

test('all 72 melakartas have seven distinct ordered pitch positions', () => {
  expect(MELAKARTA_RAGAS).toHaveLength(72)
  for (const raga of MELAKARTA_RAGAS) {
    expect(raga.pitchClasses).toHaveLength(7)
    expect(raga.pitchClasses[0]).toBe(0)
    expect(raga.pitchClasses).toContain(7)
  }
  expect(MELAKARTA_RAGAS[14].ascending).toEqual(['S', 'R1', 'G3', 'M1', 'P', 'D1', 'N3', 'S'])
  expect(MELAKARTA_RAGAS[64].ascending).toEqual(['S', 'R2', 'G3', 'M2', 'P', 'D2', 'N3', 'S'])
})

test('Mohanam excludes Ma and Ni; near-note glides keep their cents offset', () => {
  const mohanam = JANYA_RAGAS.find(raga => raga.id === 'mohanam')!
  expect(ragaPitchAtFrequency(261.63, 261.63, mohanam).allowed).toBe(true)
  expect(ragaPitchAtFrequency(261.63 * 2 ** (5 / 12), 261.63, mohanam).allowed).toBe(false)
  expect(ragaPitchAtFrequency(261.63 * 2 ** (4.12 / 12), 261.63, mohanam).cents).toBe(12)
  expect(ragaSwaraAtClass(mohanam, 4)).toBe('G3')
})

test('janya catalog preserves different ascending and descending notes', () => {
  expect(JANYA_RAGAS).toHaveLength(899)
  const bilahari = JANYA_RAGAS.find(raga => raga.name === 'Bilahari')!
  expect(bilahari.ascending).toEqual(['S', 'R2', 'G3', 'P', 'D2', 'S'])
  expect(bilahari.descending).toEqual(['S', 'N3', 'D2', 'P', 'M1', 'G3', 'R2', 'S'])
  expect(ragaPitchAtFrequency(261.63 * 2 ** (5 / 12), 261.63, bilahari).allowed).toBe(true)
  expect(ragaSwaraAtClass(bilahari, 5)).toBe('M1')
  for (const raga of JANYA_RAGAS) {
    expect(raga.pitchClasses.every(pitchClass => Number.isInteger(pitchClass) && pitchClass >= 0 && pitchClass < 12)).toBe(true)
    expect(raga.ascending.length).toBeGreaterThan(0)
    expect(raga.descending.length).toBeGreaterThan(0)
  }
})
