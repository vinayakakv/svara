import type { PitchMethod, PitchOptions, PitchResult } from './pitch'

type Vector = { delete(): void }
type EssentiaInstance = {
  arrayToVector(samples: Float32Array): Vector
  Windowing(frame: Vector, normalized: boolean, size: number, type: string): { frame: Vector }
  Spectrum(frame: Vector, size: number): { spectrum: Vector }
  PitchYin(frame: Vector, frameSize: number, interpolate: boolean, maxFrequency: number, minFrequency: number, sampleRate: number, tolerance: number): { pitch: number; pitchConfidence: number }
  PitchYinFFT(spectrum: Vector, frameSize: number, interpolate: boolean, maxFrequency: number, minFrequency: number, sampleRate: number, tolerance: number): { pitch: number; pitchConfidence: number }
}

let essentiaPromise: Promise<EssentiaInstance> | null = null

function loadEssentia() {
  essentiaPromise ??= Promise.all([
    import('essentia.js/dist/essentia.js-core.es.js'),
    import('essentia.js/dist/essentia-wasm.es.js'),
  ]).then(([core, wasm]) => new core.default(wasm.EssentiaWASM) as EssentiaInstance)
  return essentiaPromise
}

export async function detectPitchEssentia(samples: Float32Array, sampleRate: number, method: Extract<PitchMethod, 'essentia-yin' | 'essentia-yin-fft'>, options: PitchOptions): Promise<PitchResult> {
  const { minHz = 75, maxHz = 1000, minRms = 0.008, yinThreshold = 0.12, essentiaConfidence = 0.65 } = options
  if (!samples.length || minHz <= 0 || maxHz <= minHz) return null
  let power = 0
  for (const sample of samples) power += sample * sample
  const rms = Math.sqrt(power / samples.length)
  if (rms < minRms) return null

  const essentia = await loadEssentia()
  const input = essentia.arrayToVector(samples)
  let windowed: Vector | null = null
  let spectrum: Vector | null = null
  try {
    const result = method === 'essentia-yin'
      ? essentia.PitchYin(input, samples.length, true, maxHz, minHz, sampleRate, yinThreshold)
      : (() => {
          windowed = essentia.Windowing(input, false, samples.length, 'hann').frame
          spectrum = essentia.Spectrum(windowed, samples.length).spectrum
          return essentia.PitchYinFFT(spectrum, samples.length, true, maxHz, minHz, sampleRate, 1)
        })()
    const { pitch, pitchConfidence } = result
    if (!Number.isFinite(pitch) || pitch < minHz || pitch > maxHz || !Number.isFinite(pitchConfidence) || pitchConfidence < essentiaConfidence) return null
    return { frequency: pitch, confidence: pitchConfidence, rms, method }
  } finally {
    spectrum?.delete()
    windowed?.delete()
    input.delete()
  }
}
