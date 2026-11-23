import * as tf from '@tensorflow/tfjs'
import { centeredFrame, frameCenters, frameRms, resampleAudio } from './pitchDsp'
import type { PitchFrame, PitchOptions, PitchTrack } from './offlinePitch'

const modelCache = new Map<string, Promise<tf.LayersModel>>()
export function loadCrepeModel(modelUrl = '/models/crepe/model.json') {
  let promise = modelCache.get(modelUrl)
  if (!promise) {
    promise = tf.loadLayersModel(modelUrl)
    modelCache.set(modelUrl, promise)
    promise.catch(() => modelCache.delete(modelUrl))
  }
  return promise
}

export type NeuralOptions = PitchOptions & { modelUrl?: string; batchSize?: number; neuralConfidence?: number }
/** Genuine pretrained CREPE tiny model; frames are independent to preserve glides. */
export async function detectPitchNeural(samples: Float32Array, sampleRate: number, options: NeuralOptions = {}): Promise<PitchTrack> {
  const targetRate = 16000
  const resampled = resampleAudio(samples, sampleRate, targetRate)
  const hop = Math.round((options.hopLength ?? 606) * targetRate / (options.analysisRate ?? 11025))
  const centers = frameCenters(resampled.length, Math.round(3072 * targetRate / 11025), hop)
  const output: PitchFrame[] = centers.map(center => ({ time: center / targetRate, f0: null, confidence: 0, rms: 0 }))
  const valid: { index: number; frame: Float32Array }[] = []
  for (let index = 0; index < centers.length; index++) {
    const frame = centeredFrame(resampled, centers[index], 1024)
    const rms = frameRms(frame)
    output[index].rms = rms
    if (rms < (options.minRms ?? 0.005)) continue
    let mean = 0
    for (const value of frame) mean += value
    mean /= frame.length
    let variance = 0
    for (let i = 0; i < frame.length; i++) {
      frame[i] -= mean
      variance += frame[i] * frame[i]
    }
    const deviation = Math.sqrt(variance / frame.length)
    if (deviation < 1e-8) continue
    for (let i = 0; i < frame.length; i++) frame[i] /= deviation
    valid.push({ index, frame })
  }
  if (!valid.length) return output
  const model = await loadCrepeModel(options.modelUrl)
  const batchSize = Math.max(1, Math.min(64, options.batchSize ?? 16))
  for (let start = 0; start < valid.length; start += batchSize) {
    const batch = valid.slice(start, start + batchSize)
    const values = new Float32Array(batch.length * 1024)
    batch.forEach((item, index) => values.set(item.frame, index * 1024))
    const input = tf.tensor2d(values, [batch.length, 1024])
    let prediction: tf.Tensor | null = null
    try {
      const result = model.predict(input)
      prediction = Array.isArray(result) ? result[0] : result
      const activations = await prediction.data()
      if (prediction.size !== batch.length * 360) throw new Error('Unexpected CREPE output shape')
      for (let row = 0; row < batch.length; row++) {
        const offset = row * 360
        let center = 0
        for (let bin = 1; bin < 360; bin++) if (activations[offset + bin] > activations[offset + center]) center = bin
        const confidence = activations[offset + center]
        output[batch[row].index].confidence = confidence
        if (confidence < (options.neuralConfidence ?? 0.5)) continue
        let weightedCents = 0; let weightSum = 0
        for (let bin = Math.max(0, center - 4); bin <= Math.min(359, center + 4); bin++) {
          const weight = activations[offset + bin]
          weightedCents += weight * (1997.3794084376191 + bin * 20)
          weightSum += weight
        }
        const f0 = 10 * Math.pow(2, weightedCents / weightSum / 1200)
        if (f0 >= (options.minHz ?? 90) && f0 <= (options.maxHz ?? 340)) output[batch[row].index].f0 = f0
      }
    } finally {
      input.dispose()
      prediction?.dispose()
    }
  }
  return output
}
