import { expect, test } from 'bun:test'
import { analysisWindowSize, detectDominantComponent, detectPitch, noteForFrequency, swaraForFrequency } from './pitch'
import { detectPitchAutocorrelation } from './autocorrelationPitch'

const sampleRate = 48000
const makeTone = (frequency: number, harmonics = false) => Float32Array.from({ length: 4096 }, (_, index) => {
  const phase = 2 * Math.PI * frequency * index / sampleRate
  return .2 * Math.sin(phase) + (harmonics ? .08 * Math.sin(2 * phase) + .04 * Math.sin(3 * phase) : 0)
})

test('detects low and high sustained tones', () => {
  for (const frequency of [82.41, 110, 220, 440, 880]) {
    const detected = detectPitch(makeTone(frequency), sampleRate)
    expect(detected).not.toBeNull()
    expect(Math.abs(detected!.frequency - frequency)).toBeLessThan(1)
  }
})

test('keeps pitch estimates consistent across analysis sample rates', () => {
  for (const rate of [44100, 48000, 96000]) {
    const samples = Float32Array.from({ length: analysisWindowSize(rate) }, (_, index) => .2 * Math.sin(2 * Math.PI * 220 * index / rate))
    const result = detectPitch(samples, rate)
    expect(result).not.toBeNull()
    expect(Math.abs(result!.frequency - 220)).toBeLessThan(1)
  }
  expect(analysisWindowSize(44100)).toBe(4096)
  expect(analysisWindowSize(48000)).toBe(4096)
  expect(analysisWindowSize(96000)).toBe(8192)
})

test('detects fundamental when harmonics are present', () => {
  const detected = detectPitch(makeTone(196, true), sampleRate)
  expect(detected).not.toBeNull()
  expect(Math.abs(detected!.frequency - 196)).toBeLessThan(1)
})

test('autocorrelation tracks pure and harmonic-rich pitches without octave errors', () => {
  for (const frequency of [110, 196, 220, 440]) {
    for (const harmonics of [false, true]) {
      const result = detectPitchAutocorrelation(makeTone(frequency, harmonics), sampleRate)
      expect(result).not.toBeNull()
      expect(Math.abs(result!.frequency - frequency)).toBeLessThan(3)
    }
  }
})

test('autocorrelation rejects silence and honors level and correlation controls', () => {
  expect(detectPitchAutocorrelation(new Float32Array(4096), sampleRate)).toBeNull()
  expect(detectPitchAutocorrelation(makeTone(220), sampleRate, { minRms: 0.2 })).toBeNull()
  expect(detectPitchAutocorrelation(makeTone(220), sampleRate, { minHz: 300 })).toBeNull()
})

test('both live detectors find the pitch in real vocal excerpts', async () => {
  for (const [file, expected] of [['vocal-low.wav', 122.4], ['vocal-high.wav', 250.8]] as const) {
    const bytes = await Bun.file(new URL(`../../test-audio/${file}`, import.meta.url)).arrayBuffer()
    const view = new DataView(bytes)
    const rate = view.getUint32(24, true)
    const samples = Float32Array.from({ length: (bytes.byteLength - 44) / 2 }, (_, index) => view.getInt16(44 + index * 2, true) / 32768)
    const acf: number[] = []
    const yin: number[] = []
    for (let start = 0; start + 1024 <= samples.length; start += 367) {
      const frame = samples.subarray(start, start + 1024)
      const options = { minHz: 90, maxHz: 340, minRms: 0.005 }
      const acfResult = detectPitchAutocorrelation(frame, rate, options)
      const yinResult = detectPitch(frame, rate, options)
      if (acfResult) acf.push(acfResult.frequency)
      if (yinResult) yin.push(yinResult.frequency)
    }
    expect(acf.length).toBeGreaterThan(20)
    expect(yin.length).toBeGreaterThan(20)
    for (const track of [acf, yin]) {
      track.sort((a, b) => a - b)
      expect(Math.abs(track[Math.floor(track.length / 2)] - expected)).toBeLessThan(3)
    }
  }
})

test('finds a dominant component in mixed music-like tones', () => {
  const samples = Float32Array.from({ length: 4096 }, (_, index) =>
    .22 * Math.sin(2 * Math.PI * 220 * index / sampleRate)
    + .09 * Math.sin(2 * Math.PI * 330 * index / sampleRate))
  const result = detectDominantComponent(samples, sampleRate)
  expect(result?.method).toBe('spectrum')
  expect(Math.abs(result!.frequency - 220)).toBeLessThan(3)
})

test('recovers Sa from stronger tanpura overtones', () => {
  const fundamental = 130.81
  const levels = [0.025, 0.04, 0.12, 0.07, 0.09, 0.06, 0.05]
  const samples = Float32Array.from({ length: 4096 }, (_, index) =>
    levels.reduce((sum, level, harmonic) => sum + level * Math.sin(2 * Math.PI * fundamental * (harmonic + 1) * index / sampleRate), 0))
  const result = detectDominantComponent(samples, sampleRate)
  expect(result?.method).toBe('harmonics')
  expect(Math.abs(result!.frequency - fundamental)).toBeLessThan(3)
})

test('keeps a lone overtone as a spectral component', () => {
  const result = detectDominantComponent(makeTone(392), sampleRate)
  expect(result?.method).toBe('spectrum')
  expect(Math.abs(result!.frequency - 392)).toBeLessThan(3)
})

test('rejects silence', () => {
  expect(detectPitch(new Float32Array(4096), sampleRate)).toBeNull()
})

test('respects the configurable minimum signal level and pitch range', () => {
  expect(detectPitch(makeTone(220), sampleRate, { minRms: 0.2 })).toBeNull()
  expect(detectPitch(makeTone(220), sampleRate, { minHz: 300 })).toBeNull()
})

test('maps pitch to note and relative svara', () => {
  expect(noteForFrequency(440).name).toBe('A4')
  expect(swaraForFrequency(392, 261.63).name).toBe('Pa')
})
