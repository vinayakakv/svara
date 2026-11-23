import { detectPitch, type PitchMethod, type PitchOptions } from './pitch'
import { detectPitchAutocorrelation } from './autocorrelationPitch'
import { detectPitchEssentia } from './essentiaPitch'

type PitchMessage = { samples: Float32Array; sampleRate: number; detector: PitchMethod; options: PitchOptions }

self.onmessage = async ({ data }: MessageEvent<PitchMessage>) => {
  try {
    const reading = data.detector === 'yin'
      ? detectPitch(data.samples, data.sampleRate, data.options)
      : data.detector === 'acf'
        ? detectPitchAutocorrelation(data.samples, data.sampleRate, data.options)
        : await detectPitchEssentia(data.samples, data.sampleRate, data.detector, data.options)
    self.postMessage({ detector: data.detector, reading })
  } catch (error) {
    self.postMessage({ detector: data.detector, error: error instanceof Error ? error.message : String(error) })
  }
}
