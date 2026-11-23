import { fft, nextPowerOfTwo } from './pitchDsp'
import type { PitchOptions, PitchResult } from './pitch'

/** FFT autocorrelation with independent spectral checks for octave errors. */
export function detectPitchAutocorrelation(samples: Float32Array, sampleRate: number, options: PitchOptions = {}): PitchResult {
  const { minHz = 75, maxHz = 1000, minRms = 0.008, acfThreshold = 0.5 } = options
  if (!samples.length || minHz <= 0 || maxHz <= minHz) return null
  let power = 0
  let mean = 0
  for (const sample of samples) { power += sample * sample; mean += sample }
  const rms = Math.sqrt(power / samples.length)
  if (rms < minRms) return null
  mean /= samples.length

  const length = samples.length
  const size = nextPowerOfTwo(length * 2)
  const real = new Float64Array(size)
  const imaginary = new Float64Array(size)
  for (let i = 0; i < length; i++) real[i] = (samples[i] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / length))
  fft(real, imaginary)
  const magnitudes = new Float64Array(size / 2)
  let maximumMagnitude = 0
  for (let bin = 1; bin < magnitudes.length; bin++) {
    const value = Math.hypot(real[bin], imaginary[bin])
    magnitudes[bin] = value
    if (value > maximumMagnitude) maximumMagnitude = value
  }
  for (let i = 0; i < size; i++) {
    real[i] = real[i] * real[i] + imaginary[i] * imaginary[i]
    imaginary[i] = 0
  }
  fft(real, imaginary, true)
  const zeroLag = real[0]
  if (zeroLag <= 1e-12) return null
  const minLag = Math.max(2, Math.ceil(sampleRate / maxHz))
  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(length * 0.45))
  if (minLag >= maxLag) return null

  const spectralStrength = (hz: number) => {
    const center = hz * size / sampleRate
    if (center < 1 || center >= magnitudes.length - 2) return 0
    const bin = Math.round(center)
    let peak = 0
    for (let index = Math.max(1, bin - 1); index <= Math.min(magnitudes.length - 1, bin + 1); index++) {
      peak = Math.max(peak, magnitudes[index])
    }
    return peak / maximumMagnitude
  }

  let best: { frequency: number; correlation: number; score: number } | null = null
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (real[lag] < real[lag - 1] || real[lag] < real[lag + 1]) continue
    const correlation = Math.min(1, real[lag] / zeroLag * length / (length - lag))
    if (correlation < acfThreshold) continue
    const left = real[lag - 1], center = real[lag], right = real[lag + 1]
    const curvature = left - 2 * center + right
    const offset = Math.abs(curvature) > 1e-12 ? Math.max(-1, Math.min(1, 0.5 * (left - right) / curvature)) : 0
    const frequency = sampleRate / (lag + offset)
    if (frequency < minHz || frequency > maxHz) continue

    let support = 0
    let present = 0
    for (let harmonic = 1; harmonic <= 5 && frequency * harmonic < sampleRate / 2; harmonic++) {
      const strength = spectralStrength(frequency * harmonic)
      support += strength / Math.sqrt(harmonic)
      if (strength > 0.12) present++
    }
    if (!present) continue
    // A single strong overtone alone cannot establish a missing fundamental.
    const fundamental = spectralStrength(frequency)
    if (fundamental < 0.08 && present < 2) continue
    const score = correlation * 1.5 + support + (fundamental > 0.12 ? 0.2 : 0)
    if (!best || score > best.score) best = { frequency, correlation, score }
  }
  if (!best) return null
  return { frequency: best.frequency, confidence: best.correlation, rms, method: 'acf' }
}
