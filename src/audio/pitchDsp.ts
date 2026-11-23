/** Signal processing shared by the offline pitch estimators. No browser APIs. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  if (!channels.length) throw new Error('At least one audio channel is required')
  const length = Math.min(...channels.map(channel => channel.length))
  const mono = new Float32Array(length)
  for (const channel of channels) for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length
  return mono
}

export function resampleAudio(input: Float32Array, inputRate: number, outputRate = 11025): Float32Array {
  if (inputRate <= 0 || outputRate <= 0) throw new Error('Sample rates must be positive')
  if (inputRate === outputRate) return input.slice()
  const radius = 24
  const taps = radius * 2
  const phases = 1024
  const cutoff = Math.min(1, outputRate / inputRate) * 0.94
  const table = new Float32Array(phases * taps)
  for (let phase = 0; phase < phases; phase++) {
    const fraction = phase / phases
    let sum = 0
    for (let tap = 0; tap < taps; tap++) {
      const distance = tap - radius + 1 - fraction
      const x = Math.PI * distance * cutoff
      const sinc = Math.abs(x) < 1e-8 ? 1 : Math.sin(x) / x
      const window = 0.42 + 0.5 * Math.cos(Math.PI * distance / radius)
        + 0.08 * Math.cos(2 * Math.PI * distance / radius)
      const value = cutoff * sinc * window
      table[phase * taps + tap] = value
      sum += value
    }
    for (let tap = 0; tap < taps; tap++) table[phase * taps + tap] /= sum
  }
  const output = new Float32Array(Math.round(input.length * outputRate / inputRate))
  for (let i = 0; i < output.length; i++) {
    const position = i * inputRate / outputRate
    const start = Math.floor(position)
    const phase = Math.min(phases - 1, Math.round((position - start) * (phases - 1)))
    let sum = 0
    let weight = 0
    for (let tap = 0; tap < taps; tap++) {
      const index = start + tap - radius + 1
      if (index < 0 || index >= input.length) continue
      const coefficient = table[phase * taps + tap]
      sum += input[index] * coefficient
      weight += coefficient
    }
    output[i] = weight ? sum / weight : 0
  }
  return output
}

function biquad(samples: Float32Array, sampleRate: number, cutoff: number, highPass: boolean) {
  const omega = 2 * Math.PI * cutoff / sampleRate
  const cosine = Math.cos(omega)
  const alpha = Math.sin(omega) / Math.SQRT2
  const a0 = 1 + alpha
  const b0 = ((1 + (highPass ? cosine : -cosine)) / 2) / a0
  const b1 = (highPass ? -(1 + cosine) : 1 - cosine) / a0
  const b2 = b0
  const a1 = -2 * cosine / a0
  const a2 = (1 - alpha) / a0
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    samples[i] = y
    x2 = x1; x1 = x; y2 = y1; y1 = y
  }
}

export function bandPassAudio(input: Float32Array, sampleRate: number, lowHz = 85, highHz = 950) {
  if (lowHz <= 0 || highHz <= lowHz || highHz >= sampleRate / 2) throw new Error('Invalid band-pass range')
  const output = input.slice()
  biquad(output, sampleRate, lowHz, true)
  biquad(output, sampleRate, highHz, false)
  return output
}

export function nextPowerOfTwo(value: number) {
  let power = 1
  while (power < value) power *= 2
  return power
}

export function fft(real: Float64Array, imaginary: Float64Array, inverse = false) {
  const size = real.length
  if (imaginary.length !== size || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two')
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[real[i], real[j]] = [real[j], real[i]]
      ;[imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]]
    }
  }
  for (let length = 2; length <= size; length *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / length
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    for (let start = 0; start < size; start += length) {
      let wr = 1; let wi = 0
      for (let offset = 0; offset < length / 2; offset++) {
        const left = start + offset
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
  if (inverse) for (let i = 0; i < size; i++) { real[i] /= size; imaginary[i] /= size }
}

export function centeredFrame(samples: Float32Array, center: number, length: number) {
  const frame = new Float32Array(length)
  const start = Math.round(center - length / 2)
  for (let i = 0; i < length; i++) {
    const index = start + i
    if (index >= 0 && index < samples.length) frame[i] = samples[index]
  }
  return frame
}

export function frameCenters(length: number, frameLength: number, hopLength: number) {
  if (length <= 0) return []
  if (length < frameLength) return [Math.floor(length / 2)]
  const centers: number[] = []
  for (let center = Math.floor(frameLength / 2); center + Math.ceil(frameLength / 2) <= length; center += hopLength) centers.push(center)
  return centers
}

export function frameRms(frame: Float32Array) {
  let power = 0
  for (const sample of frame) power += sample * sample
  return Math.sqrt(power / frame.length)
}

export function yinCmndf(frame: Float32Array, sampleRate: number, minHz: number, maxHz: number) {
  const length = frame.length
  const maxTau = Math.min(Math.ceil(sampleRate / minHz), Math.floor(length / 2))
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz))
  const size = nextPowerOfTwo(length * 2)
  const real = new Float64Array(size)
  const imaginary = new Float64Array(size)
  let mean = 0
  for (const value of frame) mean += value
  mean /= length
  const energy = new Float64Array(length + 1)
  for (let i = 0; i < length; i++) {
    real[i] = frame[i] - mean
    energy[i + 1] = energy[i] + real[i] * real[i]
  }
  fft(real, imaginary)
  for (let i = 0; i < size; i++) {
    real[i] = real[i] * real[i] + imaginary[i] * imaginary[i]
    imaginary[i] = 0
  }
  fft(real, imaginary, true)
  const cmndf = new Float32Array(maxTau + 1)
  cmndf[0] = 1
  let total = 0
  for (let tau = 1; tau <= maxTau; tau++) {
    const difference = Math.max(0, energy[length - tau] + energy[length] - energy[tau] - 2 * real[tau])
    total += difference
    cmndf[tau] = total > 1e-15 ? difference * tau / total : 1
  }
  return { cmndf, minTau, maxTau }
}

export function refineTrough(values: Float32Array, index: number) {
  if (index <= 0 || index >= values.length - 1) return index
  const left = values[index - 1]
  const center = values[index]
  const right = values[index + 1]
  const denominator = left - 2 * center + right
  const offset = Math.abs(denominator) > 1e-10 ? 0.5 * (left - right) / denominator : 0
  return index + Math.max(-1, Math.min(1, offset))
}

export function localTroughs(values: Float32Array, minIndex: number, maxIndex: number) {
  const troughs: number[] = []
  for (let index = minIndex; index <= maxIndex; index++) {
    if (values[index] <= values[index - 1] && values[index] <= (values[index + 1] ?? Infinity)) troughs.push(index)
  }
  return troughs
}
