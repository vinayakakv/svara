import { expect, test } from 'bun:test'
import { detectPitchEssentia } from './essentiaPitch'

const rate = 48000
const methods = ['essentia-yin', 'essentia-yin-fft'] as const

test('Essentia detectors recover a harmonic-rich Sa and reject silence', async () => {
  const f0 = 130.81
  const samples = Float32Array.from({ length: 4096 }, (_, index) => {
    const phase = 2 * Math.PI * f0 * index / rate
    return 0.04 * Math.sin(phase) + 0.12 * Math.sin(2 * phase) + 0.07 * Math.sin(3 * phase)
  })
  for (const method of methods) {
    const result = await detectPitchEssentia(samples, rate, method, { minHz: 90, maxHz: 340, minRms: 0.005 })
    expect(result).not.toBeNull()
    expect(Math.abs(result!.frequency - f0)).toBeLessThan(2)
    expect(await detectPitchEssentia(new Float32Array(4096), rate, method, {})).toBeNull()
  }
})

test('Essentia detectors find real vocal pitches', async () => {
  for (const [file, expected] of [['vocal-low.wav', 122.4], ['vocal-high.wav', 250.8]] as const) {
    const bytes = await Bun.file(new URL(`../../test-audio/${file}`, import.meta.url)).arrayBuffer()
    const view = new DataView(bytes)
    const sampleRate = view.getUint32(24, true)
    const samples = Float32Array.from({ length: (bytes.byteLength - 44) / 2 }, (_, index) => view.getInt16(44 + index * 2, true) / 32768)
    for (const method of methods) {
      const estimates: number[] = []
      for (let start = 0; start + 1024 <= samples.length; start += 367) {
        const result = await detectPitchEssentia(samples.subarray(start, start + 1024), sampleRate, method, { minHz: 90, maxHz: 340, minRms: 0.005 })
        if (result) estimates.push(result.frequency)
      }
      expect(estimates.length).toBeGreaterThan(20)
      const accurate = estimates.filter(frequency => Math.abs(1200 * Math.log2(frequency / expected)) < 50)
      expect(accurate.length / estimates.length).toBeGreaterThan(0.75)
      estimates.sort((a, b) => a - b)
      expect(Math.abs(estimates[Math.floor(estimates.length / 2)] - expected)).toBeLessThan(3)
    }
  }
})
