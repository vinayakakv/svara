import { bandPassAudio, centeredFrame, fft, frameCenters, frameRms, localTroughs, refineTrough, resampleAudio, yinCmndf } from './pitchDsp'

export type PitchFrame = { time: number; f0: number | null; confidence: number; rms: number }
export type PitchTrack = PitchFrame[]
export type PitchOptions = {
  analysisRate?: number; minHz?: number; maxHz?: number; minRms?: number
  yinThreshold?: number; minConfidence?: number; hopLength?: number
  nThresholds?: number; pitchResolution?: number; maxTransitionRate?: number
  switchProbability?: number; spectralContrast?: number
}
const defaults = { analysisRate: 11025, minHz: 90, maxHz: 340, minRms: 0.005,
  yinThreshold: 0.14, minConfidence: 0.76, nThresholds: 60, pitchResolution: 0.2,
  maxTransitionRate: 12, switchProbability: 0.03, spectralContrast: 0.28 }
type Config = typeof defaults & { hopLength: number }
function configure(options: PitchOptions): Config {
  const config = { ...defaults, ...options, hopLength: options.hopLength ?? Math.round(606 * (options.analysisRate ?? 11025) / 11025) }
  if (config.minHz <= 0 || config.maxHz <= config.minHz || config.maxHz >= config.analysisRate / 2) throw new Error('Invalid pitch range')
  return config
}
function prepare(samples: Float32Array, sampleRate: number, config: Config) {
  const filtered = bandPassAudio(resampleAudio(samples, sampleRate, config.analysisRate), config.analysisRate)
  const frameLength = Math.round(3072 * config.analysisRate / 11025)
  return { filtered, frameLength, centers: frameCenters(filtered.length, frameLength, config.hopLength) }
}
function yinAt(frame: Float32Array, config: Config) {
  const rms = frameRms(frame)
  if (rms < config.minRms) return { f0: null, confidence: 0, rms }
  const { cmndf, minTau, maxTau } = yinCmndf(frame, config.analysisRate, config.minHz, config.maxHz)
  const troughs = localTroughs(cmndf, minTau, maxTau)
  const selected = troughs.find(tau => cmndf[tau] < config.yinThreshold)
    ?? troughs.reduce((best, tau) => cmndf[tau] < cmndf[best] ? tau : best, minTau)
  const confidence = Math.max(0, 1 - cmndf[selected])
  const f0 = config.analysisRate / refineTrough(cmndf, selected)
  return { f0: confidence >= config.minConfidence && f0 >= config.minHz && f0 <= config.maxHz ? f0 : null, confidence, rms }
}
export function detectPitchYIN(samples: Float32Array, sampleRate: number, options: PitchOptions = {}): PitchTrack {
  const config = configure(options)
  const { filtered, centers } = prepare(samples, sampleRate, config)
  const yinLength = Math.round(0.25 * config.analysisRate)
  return centers.map(center => ({ time: center / config.analysisRate, ...yinAt(centeredFrame(filtered, center, yinLength), config) }))
}

function betaCdf(value: number) {
  return 1 - Math.pow(1 - value, 18) * (1 + 18 * value)
}
type Observation = { probabilities: Float64Array; exactFrequencies: Float64Array; voiced: number; rms: number }
function pyinObservation(frame: Float32Array, config: Config, bins: number): Observation {
  const probabilities = new Float64Array(bins)
  const exactFrequencies = new Float64Array(bins)
  const rms = frameRms(frame)
  if (rms < config.minRms) return { probabilities, exactFrequencies, voiced: 0, rms }
  const { cmndf, minTau, maxTau } = yinCmndf(frame, config.analysisRate, config.minHz, config.maxHz)
  const troughs = localTroughs(cmndf, minTau, maxTau)
  if (!troughs.length) return { probabilities, exactFrequencies, voiced: 0, rms }
  const masses = new Float64Array(troughs.length)
  const global = troughs.reduce((best, tau, index) => cmndf[tau] < cmndf[troughs[best]] ? index : best, 0)
  let previousCdf = 0
  for (let step = 1; step <= config.nThresholds; step++) {
    const threshold = step / config.nThresholds
    const cdf = betaCdf(threshold)
    const prior = cdf - previousCdf
    previousCdf = cdf
    const eligible = troughs.map((tau, index) => cmndf[tau] < threshold ? index : -1).filter(index => index >= 0)
    if (!eligible.length) { masses[global] += prior * 0.01; continue }
    let normalization = 0
    for (let rank = 0; rank < eligible.length; rank++) normalization += Math.exp(-2 * rank)
    for (let rank = 0; rank < eligible.length; rank++) masses[eligible[rank]] += prior * Math.exp(-2 * rank) / normalization
  }
  for (let i = 0; i < troughs.length; i++) {
    const frequency = config.analysisRate / refineTrough(cmndf, troughs[i])
    if (frequency < config.minHz || frequency > config.maxHz) continue
    const bin = Math.max(0, Math.min(bins - 1, Math.round(12 * Math.log2(frequency / config.minHz) / config.pitchResolution)))
    exactFrequencies[bin] += frequency * masses[i]
    probabilities[bin] += masses[i]
  }
  let voiced = 0
  for (let bin = 0; bin < bins; bin++) {
    voiced += probabilities[bin]
    if (probabilities[bin]) exactFrequencies[bin] /= probabilities[bin]
  }
  return { probabilities, exactFrequencies, voiced: Math.min(1, voiced), rms }
}
/** Probabilistic threshold candidates plus voiced/unvoiced Viterbi decoding. */
export function detectPitchPYIN(samples: Float32Array, sampleRate: number, options: PitchOptions = {}): PitchTrack {
  const config = configure(options)
  const { filtered, frameLength, centers } = prepare(samples, sampleRate, config)
  if (!centers.length) return []
  const bins = Math.floor(12 * Math.log2(config.maxHz / config.minHz) / config.pitchResolution) + 1
  const observations = centers.map(center => pyinObservation(centeredFrame(filtered, center, frameLength), config, bins))
  const unvoiced = bins
  const width = Math.max(1, Math.round(config.maxTransitionRate * 12 * config.hopLength / config.analysisRate / config.pitchResolution))
  const back = new Int16Array(centers.length * (bins + 1))
  let previous = new Float64Array(bins + 1)
  previous.fill(Math.log(0.5 / bins))
  previous[unvoiced] = Math.log(0.5)
  const rowSums = new Float64Array(bins)
  for (let from = 0; from < bins; from++) {
    for (let to = Math.max(0, from - width); to <= Math.min(bins - 1, from + width); to++) rowSums[from] += width + 1 - Math.abs(to - from)
  }
  for (let frame = 0; frame < centers.length; frame++) {
    const current = new Float64Array(bins + 1)
    const observation = observations[frame]
    for (let to = 0; to < bins; to++) {
      let best = previous[unvoiced] + Math.log(config.switchProbability / bins)
      let fromBest = unvoiced
      for (let from = Math.max(0, to - width); from <= Math.min(bins - 1, to + width); from++) {
        const transition = (1 - config.switchProbability) * (width + 1 - Math.abs(to - from)) / rowSums[from]
        const score = previous[from] + Math.log(transition)
        if (score > best) { best = score; fromBest = from }
      }
      current[to] = best + Math.log(Math.max(1e-12, observation.probabilities[to]))
      back[frame * (bins + 1) + to] = fromBest
    }
    let best = previous[unvoiced] + Math.log(1 - config.switchProbability)
    let fromBest = unvoiced
    for (let from = 0; from < bins; from++) {
      const score = previous[from] + Math.log(config.switchProbability)
      if (score > best) { best = score; fromBest = from }
    }
    // One collapsed unvoiced state represents all pitch bins; retain their emission scale.
    current[unvoiced] = best + Math.log(Math.max(1e-12, (1 - observation.voiced) / bins))
    back[frame * (bins + 1) + unvoiced] = fromBest
    previous = current
  }
  let state = previous.reduce((best, score, index) => score > previous[best] ? index : best, 0)
  const track: PitchTrack = Array(centers.length)
  for (let frame = centers.length - 1; frame >= 0; frame--) {
    const observation = observations[frame]
    const voiced = state !== unvoiced && observation.probabilities[state] > 0
    track[frame] = { time: centers[frame] / config.analysisRate,
      f0: voiced ? observation.exactFrequencies[state] : null,
      confidence: voiced ? observation.voiced : 1 - observation.voiced, rms: observation.rms }
    state = back[frame * (bins + 1) + state]
  }
  return track
}

const harmonicWeights = [1.05, 1, 0.72, 0.52, 0.38, 0.26]
function fftAt(frame: Float32Array, config: Config) {
  const rms = frameRms(frame)
  if (rms < config.minRms) return { f0: null, confidence: 0, rms }
  const size = 16384
  const real = new Float64Array(size)
  const imaginary = new Float64Array(size)
  for (let i = 0; i < frame.length; i++) real[i] = frame[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (frame.length - 1)))
  fft(real, imaginary)
  const magnitude = new Float64Array(size / 2)
  const noiseBins: number[] = []
  for (let i = 1; i < magnitude.length; i++) {
    magnitude[i] = Math.hypot(real[i], imaginary[i])
    const hz = i * config.analysisRate / size
    if (hz >= config.minHz && hz <= config.maxHz * 6) noiseBins.push(magnitude[i])
  }
  noiseBins.sort((a, b) => a - b)
  const floor = Math.max(1e-8, noiseBins[Math.floor(noiseBins.length / 2)] ?? 0)
  const scores: number[] = []
  for (let candidate = config.minHz; candidate <= config.maxHz; candidate += 0.5) {
    let score = 0
    for (let harmonic = 1; harmonic <= 6; harmonic++) {
      const hz = candidate * harmonic
      if (hz >= config.analysisRate / 2) break
      const bin = Math.round(hz * size / config.analysisRate)
      const peak = Math.max(magnitude[bin - 1] ?? 0, magnitude[bin], magnitude[bin + 1] ?? 0)
      score += harmonicWeights[harmonic - 1] * Math.log1p(Math.max(0, peak / floor - 1))
    }
    scores.push(score)
  }
  const ordered = [...scores].sort((a, b) => a - b)
  const baseline = ordered[Math.floor(ordered.length / 2)]
  const best = scores.reduce((index, score, current) => score > scores[index] ? current : index, 0)
  const contrast = (scores[best] - baseline) / Math.max(scores[best], 1e-8)
  if (contrast < config.spectralContrast) return { f0: null, confidence: Math.max(0, contrast), rms }
  const left = scores[best - 1] ?? scores[best]
  const center = scores[best]
  const right = scores[best + 1] ?? scores[best]
  const denominator = left - 2 * center + right
  const offset = Math.abs(denominator) > 1e-8 ? Math.max(-1, Math.min(1, 0.5 * (left - right) / denominator)) : 0
  return { f0: config.minHz + (best + offset) * 0.5, confidence: Math.min(1, contrast), rms }
}
export function detectPitchFFT(samples: Float32Array, sampleRate: number, options: PitchOptions = {}): PitchTrack {
  const config = configure(options)
  const { filtered, frameLength, centers } = prepare(samples, sampleRate, config)
  return centers.map(center => ({ time: center / config.analysisRate, ...fftAt(centeredFrame(filtered, center, frameLength), config) }))
}

export type PitchComparison = { frames: number; bothVoiced: number; medianSignedCents: number | null;
  medianAbsoluteCents: number | null; within50Cents: number | null; within100Cents: number | null;
  octaveErrorRate: number | null; voicedAgreement: number | null }
function median(values: number[]) {
  if (!values.length) return null
  values.sort((a, b) => a - b)
  return values.length % 2 ? values[Math.floor(values.length / 2)] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2
}
export function comparePitchTracks(first: PitchTrack, second: PitchTrack, maxTimeDifference = 0.03): PitchComparison {
  const cents: number[] = []
  let frames = 0; let sameVoicing = 0; let within50 = 0; let within100 = 0; let octaves = 0
  let j = 0
  for (const a of first) {
    while (j + 1 < second.length && Math.abs(second[j + 1].time - a.time) < Math.abs(second[j].time - a.time)) j++
    const b = second[j]
    if (!b || Math.abs(b.time - a.time) > maxTimeDifference) continue
    frames++
    if ((a.f0 === null) === (b.f0 === null)) sameVoicing++
    if (a.f0 === null || b.f0 === null) continue
    const difference = 1200 * Math.log2(a.f0 / b.f0)
    cents.push(difference)
    if (Math.abs(difference) <= 50) within50++
    if (Math.abs(difference) <= 100) within100++
    if (Math.abs(Math.abs(difference) - 1200) <= 100) octaves++
  }
  return { frames, bothVoiced: cents.length, medianSignedCents: median([...cents]),
    medianAbsoluteCents: median(cents.map(Math.abs)), within50Cents: cents.length ? within50 / cents.length : null,
    within100Cents: cents.length ? within100 / cents.length : null,
    octaveErrorRate: cents.length ? octaves / cents.length : null,
    voicedAgreement: frames ? sameVoicing / frames : null }
}
export function detectAllPitchTracks(samples: Float32Array, sampleRate: number, options: PitchOptions = {}) {
  return { yin: detectPitchYIN(samples, sampleRate, options), pyin: detectPitchPYIN(samples, sampleRate, options),
    fft: detectPitchFFT(samples, sampleRate, options) }
}
