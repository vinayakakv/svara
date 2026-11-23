export type PitchMethod = 'acf' | 'yin' | 'essentia-yin' | 'essentia-yin-fft'
export type PitchResult = { frequency: number; confidence: number; rms: number; method: PitchMethod | 'spectrum' | 'harmonics' } | null
export type PitchOptions = { minHz?: number; maxHz?: number; minRms?: number; yinThreshold?: number; acfThreshold?: number; essentiaConfidence?: number; spectralFallback?: boolean }

/** A drone's higher partials can outlive its fundamental; some belong to the octave below. */
/** Keep roughly 85 ms of audio in the analyser at common device rates. */
export function analysisWindowSize(sampleRate: number) {
  let size = 2048
  while (size < sampleRate * 0.085 && size < 16384) size *= 2
  return size
}

/** Cheap anti-alias average before YIN; keeps work similar at 44.1, 48 and 96 kHz. */
function reduceRate(samples: Float32Array, sampleRate: number) {
  const factor = Math.max(1, Math.round(sampleRate / 24000))
  if (factor === 1) return { samples, sampleRate }
  const reduced = new Float32Array(Math.floor(samples.length / factor))
  for (let i = 0; i < reduced.length; i++) {
    let sum = 0
    for (let j = 0; j < factor; j++) sum += samples[i * factor + j]
    reduced[i] = sum / factor
  }
  return { samples: reduced, sampleRate: sampleRate / factor }
}

/** YIN difference function and cumulative mean normalized difference. */
export function detectPitch(samples: Float32Array, sampleRate: number, options: PitchOptions = {}): PitchResult {
  const { minHz = 75, maxHz = 1000, minRms = 0.008, yinThreshold = 0.12 } = options
  const reduced = reduceRate(samples, sampleRate)
  samples = reduced.samples
  sampleRate = reduced.sampleRate
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz))
  const maxTau = Math.min(Math.floor(sampleRate / minHz), Math.floor(samples.length / 2))
  if (maxTau <= minTau) return null

  let energy = 0
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i]
  const rms = Math.sqrt(energy / samples.length)
  if (rms < minRms) return null

  const windowLength = samples.length - maxTau
  const difference = new Float32Array(maxTau + 1)
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0
    for (let i = 0; i < windowLength; i++) {
      const delta = samples[i] - samples[i + tau]
      sum += delta * delta
    }
    difference[tau] = sum
  }

  const normalized = new Float32Array(maxTau + 1)
  normalized[0] = 1
  let runningSum = 0
  for (let tau = 1; tau <= maxTau; tau++) {
    runningSum += difference[tau]
    normalized[tau] = runningSum > 0 ? difference[tau] * tau / runningSum : 1
  }

  let bestTau = -1
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (normalized[tau] < yinThreshold) {
      while (tau + 1 <= maxTau && normalized[tau + 1] < normalized[tau]) tau++
      bestTau = tau
      break
    }
  }
  if (bestTau < 0) {
    let minimum = Math.min(0.35, yinThreshold + 0.08)
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (normalized[tau] < minimum) {
        minimum = normalized[tau]
        bestTau = tau
      }
    }
  }
  if (bestTau < 0) return null

  const left = normalized[bestTau - 1] ?? normalized[bestTau]
  const center = normalized[bestTau]
  const right = normalized[bestTau + 1] ?? normalized[bestTau]
  const denominator = 2 * (2 * center - left - right)
  const offset = Math.abs(denominator) > 1e-10 ? (right - left) / denominator : 0
  const frequency = sampleRate / (bestTau + Math.max(-1, Math.min(1, offset)))
  if (!Number.isFinite(frequency) || frequency < minHz || frequency > maxHz) return null
  return { frequency, confidence: Math.max(0, Math.min(1, 1 - center)), rms, method: 'yin' }
}

/** Use aligned spectral peaks to recover a fundamental, then fall back to the strongest component. */
export function detectDominantComponent(input: Float32Array, inputRate: number, options: PitchOptions = {}): PitchResult {
  const { minHz = 75, maxHz = 1000, minRms = 0.008 } = options
  const { samples, sampleRate } = reduceRate(input, inputRate)
  let energy = 0
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i]
  const rms = Math.sqrt(energy / samples.length)
  if (rms < minRms) return null

  let size = 1
  while (size * 2 <= samples.length) size *= 2
  const real = new Float32Array(size)
  const imaginary = new Float32Array(size)
  let mean = 0
  for (let i = 0; i < size; i++) mean += samples[i]
  mean /= size
  for (let i = 0; i < size; i++) real[i] = (samples[i] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)))

  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const temporary = real[i]
      real[i] = real[j]
      real[j] = temporary
    }
  }
  for (let length = 2; length <= size; length *= 2) {
    const angle = -2 * Math.PI / length
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    for (let start = 0; start < size; start += length) {
      let wr = 1
      let wi = 0
      for (let j = 0; j < length / 2; j++) {
        const left = start + j
        const right = left + length / 2
        const vr = real[right] * wr - imaginary[right] * wi
        const vi = real[right] * wi + imaginary[right] * wr
        real[right] = real[left] - vr
        imaginary[right] = imaginary[left] - vi
        real[left] += vr
        imaginary[left] += vi
        const nextWr = wr * cosine - wi * sine
        wi = wr * sine + wi * cosine
        wr = nextWr
      }
    }
  }

  const low = Math.max(2, Math.ceil(minHz * size / sampleRate))
  const high = Math.min(size / 2 - 2, Math.floor(maxHz * size / sampleRate))
  if (high <= low) return null
  const magnitude = new Float32Array(high + 2)
  let total = 0
  for (let bin = low - 1; bin <= high + 1; bin++) {
    magnitude[bin] = Math.hypot(real[bin], imaginary[bin])
    if (bin >= low && bin <= high) total += magnitude[bin]
  }
  const average = total / (high - low + 1)
  let bestBin = -1
  let bestMagnitude = 0
  for (let bin = low; bin <= high; bin++) {
    if (magnitude[bin] > bestMagnitude && magnitude[bin] >= magnitude[bin - 1] && magnitude[bin] >= magnitude[bin + 1]) {
      bestMagnitude = magnitude[bin]
      bestBin = bin
    }
  }
  const contrast = bestMagnitude / (average + 1e-8)
  if (bestBin < 0 || contrast < 3.5) return null

  const peakFrequency = (bin: number) => {
    const left = Math.log(magnitude[bin - 1] + 1e-8)
    const center = Math.log(magnitude[bin] + 1e-8)
    const right = Math.log(magnitude[bin + 1] + 1e-8)
    const denominator = 2 * (left - 2 * center + right)
    const offset = Math.abs(denominator) > 1e-8 ? Math.max(-1, Math.min(1, (left - right) / denominator)) : 0
    return (bin + offset) * sampleRate / size
  }
  const peaks: { frequency: number; magnitude: number }[] = []
  for (let bin = low; bin <= high; bin++) {
    if (magnitude[bin] >= bestMagnitude * 0.12 && magnitude[bin] >= average * 2.5
      && magnitude[bin] >= magnitude[bin - 1] && magnitude[bin] >= magnitude[bin + 1]) {
      peaks.push({ frequency: peakFrequency(bin), magnitude: magnitude[bin] })
    }
  }

  let harmonic: { frequency: number; score: number; count: number } | null = null
  for (const peak of peaks) {
    for (let harmonicNumber = 1; harmonicNumber <= 8; harmonicNumber++) {
      const candidate = peak.frequency / harmonicNumber
      if (candidate < minHz || candidate > maxHz) continue
      let score = 0
      let count = 0
      let weightedFrequency = 0
      let weightSum = 0
      for (let index = 1; index <= 8 && candidate * index <= maxHz; index++) {
        const target = candidate * index
        const tolerance = Math.max(sampleRate / size * 0.75, target * 0.012)
        const match = peaks.find(item => Math.abs(item.frequency - target) <= tolerance)
        if (!match) continue
        const weight = Math.sqrt(match.magnitude / bestMagnitude) / Math.sqrt(index)
        score += weight
        count++
        weightedFrequency += match.frequency / index * weight
        weightSum += weight
      }
      if (count >= 3 && (!harmonic || score > harmonic.score)) {
        harmonic = { frequency: weightedFrequency / weightSum, score, count }
      }
    }
  }
  if (harmonic && harmonic.frequency >= minHz && harmonic.frequency <= maxHz) {
    return { frequency: harmonic.frequency, confidence: Math.min(0.8, 0.3 + harmonic.count * 0.08), rms, method: 'harmonics' }
  }

  const frequency = peakFrequency(bestBin)
  if (frequency < minHz || frequency > maxHz) return null
  return { frequency, confidence: Math.min(0.75, Math.max(0.25, (contrast - 2) / 12)), rms, method: 'spectrum' }
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
export function noteForFrequency(frequency: number) {
  const midi = 69 + 12 * Math.log2(frequency / 440)
  const nearest = Math.round(midi)
  return {
    name: `${NOTE_NAMES[((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`,
    cents: Math.round((midi - nearest) * 100),
  }
}

export const SWARAS = ['Sa', 'Ri₁', 'Ri₂', 'Ga₂', 'Ga₃', 'Ma₁', 'Ma₂', 'Pa', 'Dha₁', 'Dha₂', 'Ni₂', 'Ni₃']
export const SHORT_SWARAS = ['S', 'R₁', 'R₂', 'G₂', 'G₃', 'M₁', 'M₂', 'P', 'D₁', 'D₂', 'N₂', 'N₃']
export function swaraForFrequency(frequency: number, saHz: number) {
  const semitones = 12 * Math.log2(frequency / saHz)
  const nearest = Math.round(semitones)
  return {
    name: SWARAS[((nearest % 12) + 12) % 12],
    cents: Math.round((semitones - nearest) * 100),
    octave: Math.floor(nearest / 12),
  }
}
