import { expect, test } from 'bun:test'
import { JANYA_RAGAS } from '../music/ragas'
import { frameAtTime, pitchCsv, type SessionFrame } from './session'

test('replay finds the frame at the playhead and does not bridge silence', () => {
  const frames: SessionFrame[] = [
    { at: 0, frequency: 220, confidence: .9, rms: .02, method: 'yin' },
    { at: 100, frequency: null, confidence: null, rms: null, method: 'yin' },
    { at: 500, frequency: 440, confidence: .8, rms: .03, method: 'yin' },
  ]
  expect(frameAtTime(frames, 70)?.frequency).toBe(220)
  expect(frameAtTime(frames, 200)?.frequency).toBeNull()
  expect(frameAtTime(frames, 450)).toBeNull()
  expect(frameAtTime(frames, 510)?.frequency).toBe(440)
})

test('CSV retains raw F0 and reflects the selected raga', () => {
  const fa = 261.63 * 2 ** (5 / 12)
  const frames: SessionFrame[] = [
    { at: 125, frequency: fa, confidence: .92, rms: .01234, method: 'acf' },
    { at: 180, frequency: null, confidence: null, rms: null, method: 'acf' },
  ]
  const mohanam = JANYA_RAGAS.find(raga => raga.name === 'Mohanam')!
  const bilahari = JANYA_RAGAS.find(raga => raga.name === 'Bilahari')!
  expect(pitchCsv(frames, 261.63, mohanam)).toContain('349.23,0.920,0.01234,acf,261.63,M1,0,Mohanam,false')
  expect(pitchCsv(frames, 261.63, bilahari)).toContain('349.23,0.920,0.01234,acf,261.63,M1,0,Bilahari,true')
  expect(pitchCsv(frames, 261.63, mohanam)).toContain('0.180,,,,acf,261.63,,,Mohanam,')
})
