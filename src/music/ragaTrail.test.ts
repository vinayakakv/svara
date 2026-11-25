import { expect, test } from 'bun:test'
import { JANYA_RAGAS } from './ragas'
import { markOutsideTrail } from './ragaTrail'

test('recolors the same retained pitch history for the selected raga', () => {
  const mohanam = JANYA_RAGAS.find(raga => raga.name === 'Mohanam')!
  const bilahari = JANYA_RAGAS.find(raga => raga.name === 'Bilahari')!
  const fa = 261.63 * 2 ** (5 / 12)
  const trail = [0, 100, 230, 300].map(at => ({ at, frequency: fa }))
  expect(markOutsideTrail(trail, mohanam, 261.63)).toEqual([false, false, true, true])
  expect(markOutsideTrail(trail, bilahari, 261.63)).toEqual([false, false, false, false])
  expect(markOutsideTrail(trail, null, 261.63)).toEqual([false, false, false, false])
})

test('silence and gaps restart the sustained outside-note timer', () => {
  const mohanam = JANYA_RAGAS.find(raga => raga.name === 'Mohanam')!
  const fa = 261.63 * 2 ** (5 / 12)
  expect(markOutsideTrail([
    { at: 0, frequency: fa }, { at: 230, frequency: fa },
    { at: 280, frequency: null }, { at: 330, frequency: fa },
    { at: 600, frequency: fa }, { at: 851, frequency: fa },
  ], mohanam, 261.63)).toEqual([false, true, false, false, false, false])
})
