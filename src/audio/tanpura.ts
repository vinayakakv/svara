export type TanpuraFirstString = 'pa' | 'ma' | 'sa'

export interface TanpuraSettings {
  saHz: number
  octave: 0 | -1
  firstString: TanpuraFirstString
  volume: number
  pace: number
}

export function tanpuraFrequencies(settings: TanpuraSettings): number[] {
  const sa = settings.saHz * 2 ** settings.octave
  const first = settings.firstString === 'pa' ? sa * 3 / 4 : settings.firstString === 'ma' ? sa * 2 / 3 : sa
  return [first, sa, sa, sa]
}

// A plucked, slightly buzzing harmonic string. The small detunings give the
// sustained sound movement without changing the string's fundamental.
export function createTanpuraString(frequency: number, sampleRate: number): Float32Array {
  const duration = 3.8
  const length = Math.round(duration * sampleRate)
  const samples = new Float32Array(length)
  const partials = [1, 2, 3, 4, 5, 6, 8, 10]
  const strengths = [1, .52, .35, .26, .19, .13, .075, .04]
  let noise = 0x12345678
  for (let i = 0; i < length; i++) {
    const time = i / sampleRate
    const envelope = (1 - Math.exp(-time * 80)) * Math.exp(-time * .92)
    let sound = 0
    for (let harmonic = 0; harmonic < partials.length; harmonic++) {
      const number = partials[harmonic]
      const decay = Math.exp(-time * (harmonic * .24))
      const phase = 2 * Math.PI * frequency * number * time
      sound += strengths[harmonic] * decay * (
        Math.sin(phase) + .13 * Math.sin(phase * 1.0019 + harmonic * .7)
      )
    }
    noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5
    const strike = ((noise >>> 0) / 0xffffffff * 2 - 1) * Math.exp(-time * 38) * .07
    samples[i] = Math.tanh((sound * envelope + strike) * .66)
  }
  return samples
}

export class TanpuraPlayer {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private timer: number | null = null
  private settings: TanpuraSettings
  private nextString = 0
  private cache = new Map<string, AudioBuffer>()
  private active = new Set<AudioBufferSourceNode>()

  constructor(settings: TanpuraSettings) { this.settings = settings }

  async start() {
    if (this.context) return
    const context = new AudioContext()
    const master = context.createGain()
    master.gain.value = this.settings.volume / 100 * .26
    master.connect(context.destination)
    this.context = context
    this.master = master
    try {
      await context.resume()
      if (this.context !== context) return
      this.pluck()
    } catch (error) {
      this.stop()
      throw error
    }
  }

  setSettings(settings: TanpuraSettings) {
    const old = this.settings
    this.settings = settings
    if (this.master && this.context) this.master.gain.setTargetAtTime(settings.volume / 100 * .26, this.context.currentTime, .035)
    if (old.saHz !== settings.saHz || old.octave !== settings.octave || old.firstString !== settings.firstString) this.cache.clear()
    if (old.pace !== settings.pace && this.context) {
      if (this.timer !== null) window.clearTimeout(this.timer)
      this.timer = window.setTimeout(() => this.pluck(), settings.pace * 1000)
    }
  }

  private pluck() {
    const context = this.context
    const master = this.master
    if (!context || !master) return
    const frequency = tanpuraFrequencies(this.settings)[this.nextString]
    const key = `${frequency.toFixed(4)}:${context.sampleRate}`
    let buffer = this.cache.get(key)
    if (!buffer) {
      const samples = createTanpuraString(frequency, context.sampleRate)
      buffer = context.createBuffer(1, samples.length, context.sampleRate)
      buffer.getChannelData(0).set(samples)
      this.cache.set(key, buffer)
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(master)
    source.onended = () => { source.disconnect(); this.active.delete(source) }
    this.active.add(source)
    source.start()
    this.nextString = (this.nextString + 1) % 4
    this.timer = window.setTimeout(() => this.pluck(), this.settings.pace * 1000)
  }

  stop() {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
    for (const source of this.active) {
      source.onended = null
      try { source.stop() } catch { /* Source may already have ended. */ }
      source.disconnect()
    }
    this.active.clear()
    this.cache.clear()
    if (this.context) void this.context.close()
    this.context = null
    this.master = null
    this.nextString = 0
  }
}
