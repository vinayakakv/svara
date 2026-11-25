import { useCallback, useEffect, useRef, useState } from 'react'
import { analysisWindowSize, noteForFrequency, swaraForFrequency, type PitchMethod, type PitchResult } from './audio/pitch'
import PitchContour, { type PitchPoint } from './PitchContour'
import TanpuraPanel from './TanpuraPanel'
import RagaPanel, { type RagaEvent } from './RagaPanel'
import SessionPanel from './SessionPanel'
import { RAGAS, ragaPitchAtFrequency } from './music/ragas'
import { clampPitchView, followPitchView, pitchViewBounds } from './music/pitchView'
import { markOutsideTrail } from './music/ragaTrail'
import { frameAtTime, frameIndexAtTime, type SessionData, type SessionFrame } from './audio/session'
import styles from './App.module.css'

type Reading = PitchResult
type Status = 'idle' | 'starting' | 'listening' | 'error'
type Detector = PitchMethod
const detectorLabels: Record<Detector, string> = {
  acf: 'FFT autocorrelation',
  yin: 'YIN',
  'essentia-yin': 'Essentia YIN',
  'essentia-yin-fft': 'Essentia YIN FFT',
}
const quickSaNotes = [{ name: 'C', semitone: 0 }, { name: 'D', semitone: 2 }, { name: 'G', semitone: 7 }, { name: 'A', semitone: 9 }] as const
const presetSaHz = (semitone: number, octave: number) => Math.round(440 * 2 ** (((octave + 1) * 12 + semitone - 69) / 12) * 100) / 100

function drawWave(canvas: HTMLCanvasElement | null, samples: Float32Array) {
  if (!canvas) return
  const { width, height } = canvas.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  context.strokeStyle = 'rgba(152, 178, 188, .16)'
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(0, height / 2)
  context.lineTo(width, height / 2)
  context.stroke()
  context.strokeStyle = '#79d9c4'
  context.lineWidth = 2
  context.shadowColor = 'rgba(121, 217, 196, .38)'
  context.shadowBlur = 12
  context.beginPath()
  for (let x = 0; x < width; x++) {
    const index = Math.floor(x / width * samples.length)
    const y = height / 2 - samples[index] * height * .5
    if (x === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.stroke()
  context.shadowBlur = 0
}

function drawSpectrum(canvas: HTMLCanvasElement | null, values: Uint8Array, sampleRate: number) {
  if (!canvas) return
  const { width, height } = canvas.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  const count = 70
  const gap = 3
  const barWidth = (width - gap * (count - 1)) / count
  for (let i = 0; i < count; i++) {
    const hz = 60 * Math.pow(3000 / 60, i / (count - 1))
    const bin = Math.min(values.length - 1, Math.round(hz * values.length * 2 / sampleRate))
    const magnitude = values[bin] / 255
    const barHeight = Math.max(2, magnitude * height)
    context.fillStyle = i < 33 ? 'rgba(121, 217, 196, .82)' : 'rgba(231, 167, 113, .8)'
    context.fillRect(i * (barWidth + gap), height - barHeight, Math.max(1, barWidth), barHeight)
  }
}

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = window.localStorage.getItem('svara-theme')
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [sourceMode, setSourceMode] = useState<'mic' | 'file'>('mic')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [reading, setReading] = useState<Reading>(null)
  const [detector, setDetector] = useState<Detector>('acf')
  const detectorRef = useRef<Detector>('acf')
  const [showScopes, setShowScopes] = useState(false)
  const showScopesRef = useRef(false)
  showScopesRef.current = showScopes
  const [inputRms, setInputRms] = useState(0)
  const [saHz, setSaHz] = useState(261.63)
  const [saDraft, setSaDraft] = useState('261.63')
  const [saOctave, setSaOctave] = useState(4)
  const [selectedRagaId, setSelectedRagaId] = useState(() => window.localStorage.getItem('svara-raga') ?? '')
  const selectedRaga = RAGAS.find(raga => raga.id === selectedRagaId) ?? null
  const ragaRef = useRef(selectedRaga)
  ragaRef.current = selectedRaga
  const saHzRef = useRef(saHz)
  saHzRef.current = saHz
  const outsideCandidateRef = useRef<{ semitone: number; since: number; announced: boolean } | null>(null)
  const lastRagaEventRef = useRef<{ semitone: number; at: number } | null>(null)
  const [ragaWarning, setRagaWarning] = useState<RagaEvent | null>(null)
  const [ragaEvents, setRagaEvents] = useState<RagaEvent[]>([])
  const [minRms, setMinRms] = useState(0.001)
  const [browserAutoGain, setBrowserAutoGain] = useState(() => window.localStorage.getItem('svara-browser-auto-gain') !== 'false')
  const [micGain, setMicGain] = useState(() => {
    const saved = Number(window.localStorage.getItem('svara-mic-gain'))
    return Number.isFinite(saved) && saved >= 1 && saved <= 16 ? saved : /Android/i.test(navigator.userAgent) ? 4 : 1
  })
  const [actualAutoGain, setActualAutoGain] = useState<boolean | null>(null)
  const [yinThreshold, setYinThreshold] = useState(0.12)
  const [acfThreshold, setAcfThreshold] = useState(0.5)
  const [essentiaConfidence, setEssentiaConfidence] = useState(0.65)
  const [minHz, setMinHz] = useState(75)
  const [maxHz, setMaxHz] = useState(1000)
  const settingsRef = useRef({ minRms, yinThreshold, acfThreshold, essentiaConfidence, minHz, maxHz })
  settingsRef.current = { minRms, yinThreshold, acfThreshold, essentiaConfidence, minHz, maxHz }
  const [sampleRate, setSampleRate] = useState(48000)
  const [inputRate, setInputRate] = useState<number | null>(null)
  const [requestedRate, setRequestedRate] = useState<number | 'auto'>(() => {
    const saved = window.localStorage.getItem('svara-sample-rate')
    return saved === '44100' || saved === '48000' || saved === '96000' ? Number(saved) : 'auto'
  })
  const [windowSize, setWindowSize] = useState(4096)
  const [log, setLog] = useState<{ note: string; frequency: number; time: string }[]>([])
  const lastLoggedNoteRef = useRef('')
  const [trail, setTrail] = useState<PitchPoint[]>([])
  const [trailNow, setTrailNow] = useState(() => performance.now())
  const [session, setSession] = useState<SessionData | null>(null)
  const [replayTimeMs, setReplayTimeMs] = useState(0)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [recordingSupported, setRecordingSupported] = useState(() => typeof MediaRecorder !== 'undefined')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const sessionFramesRef = useRef<SessionFrame[]>([])
  const sessionStartAtRef = useRef(0)
  const fileSessionRef = useRef<{ file: File; durationMs: number } | null>(null)
  const fileCompletedRef = useRef(false)
  const [trailSeconds, setTrailSeconds] = useState(8)
  const [centerSemi, setCenterSemi] = useState(6)
  const [rangeSemis, setRangeSemis] = useState(36)
  const [autoFollow, setAutoFollow] = useState(false)
  const [holdTrail, setHoldTrail] = useState(false)
  const holdTrailRef = useRef(false)
  holdTrailRef.current = holdTrail
  const contextRef = useRef<AudioContext | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const wakeLockPendingRef = useRef(false)
  const micGainNodeRef = useRef<GainNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const frameRef = useRef<number | null>(null)
  const startGenerationRef = useRef(0)
  const workerRef = useRef<Worker | null>(null)
  const workerBusyRef = useRef(false)
  const waveRef = useRef<HTMLCanvasElement>(null)
  const spectrumRef = useRef<HTMLCanvasElement>(null)
  const lastSampleRef = useRef(0)
  const lastDrawRef = useRef(0)
  const lastLevelRef = useRef(0)
  const recentRef = useRef<number[]>([])
  const missingRef = useRef(0)

  const requestWakeLock = useCallback(async () => {
    if (!navigator.wakeLock || document.visibilityState !== 'visible' || wakeLockRef.current || wakeLockPendingRef.current) return
    wakeLockPendingRef.current = true
    try {
      const sentinel = await navigator.wakeLock.request('screen')
      if (!contextRef.current) { void sentinel.release(); return }
      wakeLockRef.current = sentinel
      sentinel.addEventListener('release', () => { if (wakeLockRef.current === sentinel) wakeLockRef.current = null })
    } catch { /* Browser or system may deny the wake lock. */ }
    finally { wakeLockPendingRef.current = false }
  }, [])

  const stop = useCallback(() => {
    const generation = ++startGenerationRef.current
    const context = contextRef.current
    const recorder = recorderRef.current
    recorderRef.current = null
    const chunks = recordedChunksRef.current
    const frames = [...sessionFramesRef.current]
    const elapsedMs = Math.max(0, performance.now() - sessionStartAtRef.current)
    const completedFile = fileCompletedRef.current ? fileSessionRef.current : null
    fileSessionRef.current = null
    fileCompletedRef.current = false
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => {
        const audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        if (audio.size && startGenerationRef.current === generation) {
          const extension = audio.type.includes('mp4') ? 'm4a' : 'webm'
          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          setSession({ audio, audioName: `svara-${stamp}.${extension}`, frames, durationMs: elapsedMs, source: 'mic' })
          setReplayTimeMs(elapsedMs)
        }
        if (context) void context.close()
      }
      try { recorder.stop() } catch { if (context) void context.close() }
    } else {
      if (completedFile && startGenerationRef.current === generation) {
        setSession({ audio: completedFile.file, audioName: completedFile.file.name, frames, durationMs: completedFile.durationMs, source: 'file' })
        setReplayTimeMs(completedFile.durationMs)
      }
      if (context) void context.close()
    }
    setReplayPlaying(false)
    if (wakeLockRef.current) void wakeLockRef.current.release()
    wakeLockRef.current = null
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    workerRef.current?.terminate()
    workerRef.current = null
    workerBusyRef.current = false
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (fileSourceRef.current) {
      fileSourceRef.current.onended = null
      try { fileSourceRef.current.stop() } catch { /* Already ended. */ }
      fileSourceRef.current.disconnect()
      fileSourceRef.current = null
    }
    contextRef.current = null
    micGainNodeRef.current = null
    recentRef.current = []
    missingRef.current = 0
    lastLoggedNoteRef.current = ''
    setInputRate(null)
    setActualAutoGain(null)
    setInputRms(0)
    setReading(null)
    setStatus('idle')
  }, [])

  useEffect(() => {
    window.localStorage.setItem('svara-theme', theme)
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }, [theme])

  useEffect(() => { window.localStorage.setItem('svara-sample-rate', String(requestedRate)) }, [requestedRate])
  useEffect(() => { window.localStorage.setItem('svara-mic-gain', String(micGain)) }, [micGain])
  useEffect(() => { window.localStorage.setItem('svara-browser-auto-gain', String(browserAutoGain)) }, [browserAutoGain])
  useEffect(() => {
    const node = micGainNodeRef.current
    if (node) node.gain.setTargetAtTime(micGain, node.context.currentTime, .025)
  }, [micGain])
  useEffect(() => { window.localStorage.setItem('svara-raga', selectedRagaId) }, [selectedRagaId])

  useEffect(() => {
    const view = clampPitchView(centerSemi, rangeSemis, minHz, maxHz, saHz)
    if (Math.abs(view.center - centerSemi) > 0.001) setCenterSemi(view.center)
    if (Math.abs(view.range - rangeSemis) > 0.001) setRangeSemis(view.range)
  }, [centerSemi, rangeSemis, minHz, maxHz, saHz])

  useEffect(() => {
    if (!autoFollow || holdTrail || status !== 'listening' || !reading) return
    setCenterSemi(current => {
      const view = clampPitchView(current, rangeSemis, minHz, maxHz, saHz)
      return followPitchView(view, reading.frequency, minHz, maxHz, saHz).center
    })
  }, [autoFollow, holdTrail, status, reading, rangeSemis, minHz, maxHz, saHz])

  useEffect(() => {
    const resumeVisibleAudio = () => {
      if (document.visibilityState !== 'visible' || !contextRef.current) return
      if (contextRef.current.state === 'suspended') void contextRef.current.resume().catch(() => {})
      void requestWakeLock()
    }
    document.addEventListener('visibilitychange', resumeVisibleAudio)
    return () => document.removeEventListener('visibilitychange', resumeVisibleAudio)
  }, [requestWakeLock])

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    workerRef.current?.terminate()
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null
      recorderRef.current.stop()
    }
    streamRef.current?.getTracks().forEach(track => track.stop())
    if (fileSourceRef.current) {
      fileSourceRef.current.onended = null
      try { fileSourceRef.current.stop() } catch { /* Already ended. */ }
    }
    if (contextRef.current) void contextRef.current.close()
    if (wakeLockRef.current) void wakeLockRef.current.release()
  }, [])

  useEffect(() => {
    const hot = import.meta.hot
    const releaseForCodeUpdate = (payload: { updates: { type: string }[] }) => {
      if (payload.updates.some(update => update.type === 'js-update')) stop()
    }
    hot?.on('vite:beforeUpdate', releaseForCodeUpdate)
    return () => hot?.off('vite:beforeUpdate', releaseForCodeUpdate)
  }, [stop])

  const start = async () => {
    const generation = ++startGenerationRef.current
    setError('')
    if (sourceMode === 'mic' && !navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext
        ? 'This browser does not expose microphone access. Check its app and site microphone permissions.'
        : 'Microphone access needs HTTPS on a phone. A local network HTTP address is blocked by most browsers.')
      setStatus('error')
      return
    }
    if (sourceMode === 'file' && !audioFile) {
      setError('Choose an audio file to analyze.')
      setStatus('error')
      return
    }
    try {
      setStatus('starting')
      setSession(null)
      setReplayPlaying(false)
      setReplayTimeMs(0)
      sessionFramesRef.current = []
      recordedChunksRef.current = []
      fileSessionRef.current = null
      fileCompletedRef.current = false
      setTrail([])
      setLog([])
      setRagaWarning(null)
      setRagaEvents([])
      outsideCandidateRef.current = null
      lastRagaEventRef.current = null
      setHoldTrail(false)
      holdTrailRef.current = false
      setTrailNow(performance.now())
      let stream: MediaStream | null = null
      if (sourceMode === 'mic') {
        const audioConstraints: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: browserAutoGain }
        if (requestedRate !== 'auto' && navigator.mediaDevices.getSupportedConstraints?.().sampleRate) audioConstraints.sampleRate = { ideal: requestedRate }
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false })
        if (generation !== startGenerationRef.current) {
          stream.getTracks().forEach(track => track.stop())
          return
        }
        streamRef.current = stream
        setInputRate(stream.getAudioTracks()[0]?.getSettings().sampleRate ?? null)
        setActualAutoGain(stream.getAudioTracks()[0]?.getSettings().autoGainControl ?? null)
      }
      const context = new AudioContext(requestedRate === 'auto' ? undefined : { sampleRate: requestedRate })
      contextRef.current = context
      let source: AudioNode
      let playback: AudioBufferSourceNode | null = null
      if (stream) {
        source = context.createMediaStreamSource(stream)
      } else {
        const bytes = await audioFile!.arrayBuffer()
        const buffer = await context.decodeAudioData(bytes)
        if (generation !== startGenerationRef.current) return
        setInputRate(buffer.sampleRate)
        playback = context.createBufferSource()
        playback.buffer = buffer
        playback.connect(context.destination)
        fileSourceRef.current = playback
        fileSessionRef.current = { file: audioFile!, durationMs: buffer.duration * 1000 }
        source = playback
      }
      await context.resume()
      if (generation !== startGenerationRef.current) {
        stream?.getTracks().forEach(track => track.stop())
        void context.close()
        return
      }
      setSampleRate(context.sampleRate)
      const size = analysisWindowSize(context.sampleRate)
      setWindowSize(size)
      const analyser = context.createAnalyser()
      analyser.fftSize = size
      analyser.smoothingTimeConstant = .72
      analyser.minDecibels = -100
      analyser.maxDecibels = -30
      if (stream) {
        const gain = context.createGain()
        gain.gain.value = micGain
        micGainNodeRef.current = gain
        source.connect(gain)
        gain.connect(analyser)
        if (typeof MediaRecorder !== 'undefined') {
          try {
            const recordingOutput = context.createMediaStreamDestination()
            source.connect(recordingOutput)
            const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type))
            const recorder = new MediaRecorder(recordingOutput.stream, mimeType ? { mimeType } : undefined)
            const chunks: Blob[] = []
            recordedChunksRef.current = chunks
            recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
            recorder.onerror = () => setRecordingSupported(false)
            recorderRef.current = recorder
            setRecordingSupported(true)
          } catch { setRecordingSupported(false) }
        }
      } else source.connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      const spectrum = new Uint8Array(analyser.frequencyBinCount)
      const worker = new Worker(new URL('./audio/pitch.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      workerBusyRef.current = false
      lastSampleRef.current = 0
      lastDrawRef.current = 0
      lastLevelRef.current = 0
      sessionStartAtRef.current = performance.now()
      try { recorderRef.current?.start(1000) }
      catch { recorderRef.current = null; setRecordingSupported(false) }
      worker.onmessage = ({ data }: MessageEvent<{ detector: Detector; reading?: Reading; error?: string }>) => {
        if (generation !== startGenerationRef.current) return
        workerBusyRef.current = false
        if (data.detector !== detectorRef.current) return
        if (data.error) {
          stop()
          setError(`Pitch analysis failed: ${data.error}`)
          setStatus('error')
          return
        }
        const detected = data.reading ?? null
        const at = performance.now()
        if (detected) {
          missingRef.current = 0
          const recent = recentRef.current
          if (recent.length && Math.abs(1200 * Math.log2(detected.frequency / recent[recent.length - 1])) > 70) recent.length = 0
          recent.push(detected.frequency)
          if (recent.length > 3) recent.shift()
          const sorted = [...recent].sort((a, b) => a - b)
          const frequency = sorted[Math.floor(sorted.length / 2)]
          sessionFramesRef.current.push({ at: at - sessionStartAtRef.current, frequency, confidence: detected.confidence, rms: detected.rms, method: data.detector })
          setReading({ ...detected, frequency })
          const activeRaga = ragaRef.current
          const ragaPitch = activeRaga ? ragaPitchAtFrequency(frequency, saHzRef.current, activeRaga) : null
          if (ragaPitch && !ragaPitch.allowed && Math.abs(ragaPitch.cents) <= 30) {
            let candidate = outsideCandidateRef.current
            if (!candidate || candidate.semitone !== ragaPitch.semitone) {
              candidate = { semitone: ragaPitch.semitone, since: at, announced: false }
              outsideCandidateRef.current = candidate
              setRagaWarning(null)
            }
            if (at - candidate.since >= 220) {
              if (!candidate.announced) {
                candidate.announced = true
                const event = { label: ragaPitch.label, frequency, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
                setRagaWarning(event)
                const last = lastRagaEventRef.current
                if (!last || last.semitone !== ragaPitch.semitone || at - last.at >= 3000) {
                  setRagaEvents(previous => [event, ...previous].slice(0, 6))
                  lastRagaEventRef.current = { semitone: ragaPitch.semitone, at }
                }
              }
            }
          } else {
            outsideCandidateRef.current = null
            setRagaWarning(null)
          }
          if (!holdTrailRef.current) {
            setTrail(previous => [...previous.filter(point => at - point.at <= 30000), { at, frequency }])
            setTrailNow(at)
          }
          const noteName = noteForFrequency(frequency).name
          if (noteName !== lastLoggedNoteRef.current && recent.length >= 3) {
            lastLoggedNoteRef.current = noteName
            setLog(previous => [{ note: noteName, frequency, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }, ...previous].slice(0, 6))
          }
        } else {
          sessionFramesRef.current.push({ at: at - sessionStartAtRef.current, frequency: null, confidence: null, rms: null, method: data.detector })
          missingRef.current++
          recentRef.current = []
          if (missingRef.current >= 3) setReading(null)
          if (missingRef.current >= 3) lastLoggedNoteRef.current = ''
          if (missingRef.current >= 3) { outsideCandidateRef.current = null; setRagaWarning(null) }
          if (!holdTrailRef.current) {
            setTrail(previous => [...previous.filter(point => at - point.at <= 30000), { at, frequency: null }])
            setTrailNow(at)
          }
        }
      }
      worker.onerror = () => {
        stop()
        setError('Pitch analysis stopped unexpectedly. Try starting again.')
        setStatus('error')
      }
      setStatus('listening')
      void requestWakeLock()
      const tick = (time: number) => {
        if (time - lastDrawRef.current >= 33) {
          analyser.getFloatTimeDomainData(samples)
          if (showScopesRef.current) {
            analyser.getByteFrequencyData(spectrum)
            drawWave(waveRef.current, samples)
            drawSpectrum(spectrumRef.current, spectrum, context.sampleRate)
          }
          if (time - lastLevelRef.current >= 100) {
            let sum = 0
            for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
            setInputRms(Math.sqrt(sum / samples.length))
            lastLevelRef.current = time
          }
          lastDrawRef.current = time
        }
        if (time - lastSampleRef.current >= 50 && !workerBusyRef.current) {
          analyser.getFloatTimeDomainData(samples)
          const copy = samples.slice()
          workerBusyRef.current = true
          worker.postMessage({ samples: copy, sampleRate: context.sampleRate, detector: detectorRef.current, options: settingsRef.current }, [copy.buffer])
          lastSampleRef.current = time
        }
        frameRef.current = requestAnimationFrame(tick)
      }
      frameRef.current = requestAnimationFrame(tick)
      stream?.getAudioTracks()[0]?.addEventListener('ended', stop, { once: true })
      if (playback) {
        playback.onended = () => { fileCompletedRef.current = true; stop() }
        playback.start()
      }
    } catch (cause) {
      stop()
      setError(sourceMode === 'file' ? 'Could not decode or play this audio file. Try WAV, MP3, or another browser-supported format.'
        : cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? cause.message.toLowerCase().includes('system')
          ? 'macOS blocked the microphone. Enable Chrome in System Settings → Privacy & Security → Microphone, then try again.'
          : /Android/i.test(navigator.userAgent)
            ? 'Microphone permission was denied. Check both the browser app permission in Android settings and this site’s microphone permission, then try again.'
            : 'Microphone permission was denied. Allow access in your browser and try again.'
        : cause instanceof DOMException && cause.name === 'NotSupportedError'
          ? 'That analysis sample rate is not supported by this browser. Try Auto or 48 kHz.'
        : 'Could not start the microphone. Check that an input device is connected.')
      setStatus('error')
    }
  }

  const replayFrame = session ? frameAtTime(session.frames, replayTimeMs) : null
  const displayReading: Reading = session
    ? replayFrame?.frequency ? { frequency: replayFrame.frequency, confidence: replayFrame.confidence ?? 0, rms: replayFrame.rms ?? 0, method: replayFrame.method ?? detector } : null
    : reading
  const displayRms = session ? replayFrame?.rms ?? 0 : inputRms
  const note = displayReading ? noteForFrequency(displayReading.frequency) : null
  const swara = displayReading ? swaraForFrequency(displayReading.frequency, saHz) : null
  const ragaPitch = displayReading && selectedRaga ? ragaPitchAtFrequency(displayReading.frequency, saHz, selectedRaga) : null
  const replayFrameIndex = session ? frameIndexAtTime(session.frames, replayTimeMs) : -1
  const replayOutside = session && selectedRaga && replayFrameIndex >= 0
    ? markOutsideTrail(session.frames.slice(Math.max(0, replayFrameIndex - 10), replayFrameIndex + 1), selectedRaga, saHz).at(-1) ?? false
    : false
  const replayWarning: RagaEvent | null = replayOutside && replayFrame?.frequency && ragaPitch
    ? { label: ragaPitch.label, frequency: replayFrame.frequency, time: `${(replayFrame.at / 1000).toFixed(1)}s` }
    : null
  const activeRagaWarning = session ? replayWarning : ragaWarning
  const cents = swara?.cents ?? 0
  const strength = Math.min(100, Math.round(displayRms * 4000))

  useEffect(() => {
    if (!session || !replayPlaying || !autoFollow || !displayReading) return
    setCenterSemi(current => {
      const view = clampPitchView(current, rangeSemis, minHz, maxHz, saHz)
      return followPitchView(view, displayReading.frequency, minHz, maxHz, saHz).center
    })
  }, [session, replayPlaying, autoFollow, replayFrame, rangeSemis, minHz, maxHz, saHz])
  const pitchView = clampPitchView(centerSemi, rangeSemis, minHz, maxHz, saHz)
  const bounds = pitchViewBounds(minHz, maxHz, saHz)
  const maxViewRange = Math.min(60, bounds.upper - bounds.lower)
  const changePitchView = (center: number, range: number) => {
    const next = clampPitchView(center, range, minHz, maxHz, saHz)
    setAutoFollow(false)
    setCenterSemi(next.center)
    setRangeSemis(next.range)
  }
  const setSaReference = (frequency: number) => {
    setSaHz(frequency)
    setSaDraft(frequency.toFixed(2))
  }
  const commitSaDraft = () => {
    const frequency = Number(saDraft)
    if (Number.isFinite(frequency) && frequency >= 50 && frequency <= 1000) setSaReference(frequency)
    else setSaDraft(saHz.toFixed(2))
  }
  const changeSaOctave = (octave: number) => {
    const activeNote = quickSaNotes.find(note => Math.abs(presetSaHz(note.semitone, saOctave) - saHz) < 0.015)
    setSaOctave(octave)
    if (activeNote) setSaReference(presetSaHz(activeNote.semitone, octave))
  }
  const selectDetector = (next: Detector) => {
    if (next === detectorRef.current) return
    detectorRef.current = next
    setDetector(next)
    setReading(null)
    recentRef.current = []
    missingRef.current = 0
    lastLoggedNoteRef.current = ''
    setTrail([])
    setLog([])
  }
  const selectRaga = (id: string) => {
    setSelectedRagaId(id)
    ragaRef.current = RAGAS.find(raga => raga.id === id) ?? null
    outsideCandidateRef.current = null
    lastRagaEventRef.current = null
    setRagaWarning(null)
    setRagaEvents([])
  }

  return (
    <div className={styles.app} data-theme={theme}>
      <header className={styles.header}>
        <div className={styles.brand}><span className={styles.brandMark}>〰</span><span>svara<span className={styles.brandDot}>.</span></span><span className={styles.brandSub}>LIVE PITCH</span></div>
        <div className={styles.sourceControls}>
          <select aria-label="Audio source" value={sourceMode} disabled={status === 'starting' || status === 'listening'} onChange={event => { setSourceMode(event.target.value as 'mic' | 'file'); setError('') }}><option value="mic">Microphone</option><option value="file">Audio file</option></select>
          {sourceMode === 'file' && <label className={styles.filePicker} title={audioFile?.name ?? 'Choose an audio file'}><span>{audioFile?.name ?? 'Choose audio'}</span><input aria-label="Choose audio file" type="file" accept="audio/*" disabled={status === 'starting' || status === 'listening'} onChange={event => { setAudioFile(event.target.files?.[0] ?? null); setError('') }} /></label>}
          <button className={`${styles.listenButton} ${status === 'listening' ? styles.stopButton : ''}`} disabled={status === 'starting'} onClick={status === 'listening' ? stop : start}><span>{status === 'listening' ? '■' : '●'}</span>{status === 'listening' ? sourceMode === 'file' ? 'Stop playback' : 'Stop listening' : status === 'starting' ? 'Starting…' : sourceMode === 'file' ? 'Play & analyze' : 'Start listening'}</button>
        </div>
        <div className={styles.headerRight}><span className={styles.liveStatus}><span className={`${styles.statusDot} ${status === 'listening' ? styles.active : ''}`} />{status === 'listening' ? 'Listening' : status === 'starting' ? 'Starting' : 'Idle'}</span><button className={styles.themeButton} type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? '☀' : '☾'}</button></div>
      </header>

      <main className={styles.main}>
        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.dashboard}>
        <div className={`${styles.workspace} ${!showScopes ? styles.workspaceSolo : ''}`}>
          <section className={styles.pitchCard} aria-label="Detection controls">
            <div className={styles.cardTop}><span className={styles.label}>DETECTION CONTROLS</span><div className={styles.cardActions}><span className={styles.inputTag}>{session ? 'REPLAY' : sourceMode === 'file' ? 'FILE INPUT' : 'MIC INPUT'}</span><button className={styles.scopeToggle} type="button" aria-expanded={showScopes} onClick={() => setShowScopes(value => !value)}>{showScopes ? 'Hide scopes' : 'Show scopes'}</button></div></div>
            <div className={styles.tuner}>
              <div className={styles.tunerLabels}><span>♭ FLAT</span><span>{swara ? `${cents > 0 ? '+' : ''}${cents} ¢` : 'IN TUNE'}</span><span>SHARP ♯</span></div>
              <div className={styles.tunerTrack}><div className={styles.tunerZone} /><div className={styles.tunerCenter} /><div className={styles.tunerNeedle} style={{ left: `${50 + cents}%`, opacity: displayReading ? 1 : .28 }} /></div>
              <div className={styles.tunerTicks}><span>−50</span><span>0</span><span>+50</span></div>
            </div>
            <div className={styles.pitchMeta}><span>{displayReading ? `${Math.round(displayReading.confidence * 100)}% ${displayReading.method === 'acf' ? 'ACF correlation' : 'pitch confidence'}` : session ? 'No pitch at playhead' : status === 'listening' ? inputRms < minRms ? 'Below minimum level' : 'No stable single pitch' : 'Waiting for audio'}</span><div className={styles.signal}><span>{session ? 'FRAME RMS' : 'INPUT RMS'}</span><div><span style={{ width: `${strength}%` }} /></div><span>{displayRms.toFixed(4)}</span></div></div>
            <div className={styles.bottomControls}>
              <div className={styles.algorithmRow}>
                <label htmlFor="pitch-algorithm">ALGORITHM</label>
                <select id="pitch-algorithm" value={detector} onChange={event => selectDetector(event.target.value as Detector)}>
                  {(Object.entries(detectorLabels) as [Detector, string][]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className={styles.saControl}>
                <label htmlFor="sa-frequency">REFERENCE SA</label>
                <div className={styles.saInput}><input id="sa-frequency" aria-label="Sa reference frequency in hertz" type="text" inputMode="decimal" value={saDraft} onChange={event => { setSaDraft(event.target.value); const frequency = Number(event.target.value); if (event.target.value.trim() && Number.isFinite(frequency) && frequency >= 50 && frequency <= 1000) setSaHz(frequency) }} onBlur={commitSaDraft} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /><span>Hz</span></div>
                <div className={styles.quickSa}>
                  <select aria-label="Sa preset octave" value={saOctave} onChange={event => changeSaOctave(Number(event.target.value))}>{[2, 3, 4, 5].map(octave => <option key={octave} value={octave}>Oct {octave}</option>)}</select>
                  {quickSaNotes.map(note => { const frequency = presetSaHz(note.semitone, saOctave); return <button key={note.name} type="button" className={Math.abs(saHz - frequency) < 0.015 ? styles.selected : ''} onClick={() => setSaReference(frequency)}>{note.name}{saOctave}</button> })}
                </div>
              </div>
            </div>
          </section>

          <RagaPanel raga={selectedRaga} onSelect={selectRaga} warning={activeRagaWarning} events={session ? [] : ragaEvents} />

          {showScopes && <div className={styles.visualStack}>
            <section className={styles.visualCard}><div className={styles.visualHeading}><span className={styles.label}>WAVEFORM</span><span>AMPLITUDE / TIME</span></div><div className={styles.plot}><div className={`${styles.yTicks} ${styles.axisLabels}`}><span>+1</span><span>0</span><span>−1</span></div><div className={styles.canvasWrap}><canvas ref={waveRef} aria-label="Live amplitude waveform over time" /></div><div className={`${styles.xTicks} ${styles.axisLabels}`}><span>0</span><span>{Math.round(windowSize / 2 / sampleRate * 1000)} ms</span><span>{Math.round(windowSize / sampleRate * 1000)} ms</span></div></div></section>
            <section className={styles.visualCard}><div className={styles.visualHeading}><span className={styles.label}>SPECTRUM</span><span>dB / Hz</span></div><div className={styles.plot}><div className={`${styles.yTicks} ${styles.axisLabels}`}><span>−30</span><span>−65</span><span>−100</span></div><div className={styles.canvasWrap}><canvas ref={spectrumRef} aria-label="Live spectrum level in decibels by frequency" /></div><div className={`${styles.xTicks} ${styles.spectrumTicks} ${styles.axisLabels}`}><span>60</span><span>300</span><span>1k</span><span>3k</span></div></div></section>
          </div>}
        <details className={styles.settings}><summary>DETECTION SETTINGS · {status === 'listening' ? `${sourceMode === 'file' ? 'file' : 'mic'} ${inputRate ? `${(inputRate / 1000).toFixed(1)} kHz` : 'rate unknown'} / analysis ${(sampleRate / 1000).toFixed(1)} kHz` : 'sample rate, threshold and range'}</summary><div className={styles.settingsGrid}>
          <label className={styles.settingField}>Minimum level <output>{minRms.toFixed(4)} RMS</output><input type="range" min="0.0001" max="0.05" step="0.0001" value={minRms} onChange={event => setMinRms(Number(event.target.value))} /></label>
          <label className={styles.settingField}>Mic input gain <output>{micGain}×</output><input aria-label="Mic input gain" type="range" min="1" max="16" step="1" value={micGain} onChange={event => setMicGain(Number(event.target.value))} /><small>Applies live to the mic before pitch analysis; also raises background noise.</small></label>
          <label className={styles.settingField}>Browser auto gain <input aria-label="Browser auto gain" type="checkbox" checked={browserAutoGain} disabled={status === 'listening' || status === 'starting'} onChange={event => setBrowserAutoGain(event.target.checked)} /><small>{status === 'listening' && sourceMode === 'mic' ? `Browser reports ${actualAutoGain === null ? 'unknown' : actualAutoGain ? 'on' : 'off'}. ` : ''}Restart listening to apply.</small></label>
          <label className={styles.settingField}>YIN threshold <output>{yinThreshold.toFixed(2)}</output><input type="range" min="0.06" max="0.25" step="0.01" value={yinThreshold} onChange={event => setYinThreshold(Number(event.target.value))} /></label>
          <label className={styles.settingField}>Autocorrelation minimum <output>{acfThreshold.toFixed(2)}</output><input type="range" min="0.2" max="0.9" step="0.05" value={acfThreshold} onChange={event => setAcfThreshold(Number(event.target.value))} /></label>
          <label className={styles.settingField}>Essentia minimum confidence <output>{essentiaConfidence.toFixed(2)}</output><input type="range" min="0" max="0.95" step="0.05" value={essentiaConfidence} onChange={event => setEssentiaConfidence(Number(event.target.value))} /></label>
          <label className={styles.settingField}>Minimum pitch <output>{minHz} Hz</output><input type="range" min="60" max="300" step="5" value={minHz} onChange={event => setMinHz(Math.min(Number(event.target.value), maxHz - 50))} /></label>
          <label className={styles.settingField}>Maximum pitch <output>{maxHz} Hz</output><input type="range" min="400" max="2000" step="25" value={maxHz} onChange={event => setMaxHz(Math.max(Number(event.target.value), minHz + 50))} /></label>
          <label className={styles.settingField}>Sample rate <select value={requestedRate} disabled={status === 'listening' || status === 'starting'} onChange={event => setRequestedRate(event.target.value === 'auto' ? 'auto' : Number(event.target.value))}><option value="auto">Auto (device)</option><option value="44100">44.1 kHz</option><option value="48000">48 kHz</option><option value="96000">96 kHz</option></select><small>Restart listening to apply. Browser may resample the mic.</small></label>
        </div></details>
        </div>
        <div className={styles.historyGrid}>
          <section className={styles.trailCard}>
            <div className={styles.contourHeader}>
              <div><span className={styles.label}>SVARA PITCH CONTOUR</span><p>Drag to move pitch · pinch or scroll to zoom</p></div>
              <div className={styles.contourControls}>
                <div className={styles.zoomControls} aria-label="Pitch chart time window">{[8, 16, 30].map(seconds => <button key={seconds} aria-pressed={trailSeconds === seconds} onClick={() => setTrailSeconds(seconds)}>{seconds}s</button>)}</div>
                <div className={styles.octaveControls} aria-label="Pitch chart octave">
                  <button aria-label="Shift chart down one octave" onClick={() => changePitchView(pitchView.center - 12, pitchView.range)}>↓</button>
                  <button aria-label="Center chart on Sa" onClick={() => changePitchView(0, pitchView.range)}>Sa</button>
                  <button aria-label="Shift chart up one octave" onClick={() => changePitchView(pitchView.center + 12, pitchView.range)}>↑</button>
                </div>
                <div className={styles.octaveControls} aria-label="Pitch chart zoom">
                  <button aria-label="Zoom out pitch chart" disabled={pitchView.range >= maxViewRange - 0.01} onClick={() => changePitchView(pitchView.center, pitchView.range + 6)}>−</button>
                  <button aria-label="Reset pitch chart view" title="Reset pitch view" onClick={() => changePitchView(6, 36)}>{(pitchView.range / 12).toFixed(1)} oct</button>
                  <button aria-label="Zoom in pitch chart" disabled={pitchView.range <= 12.01} onClick={() => changePitchView(pitchView.center, pitchView.range - 6)}>+</button>
                </div>
                <button aria-label="Auto-follow pitch" aria-pressed={autoFollow} title="Keep the detected pitch in view" onClick={() => setAutoFollow(value => !value)}>{autoFollow ? 'Auto ●' : 'Auto'}</button>
                <button className={styles.holdButton} aria-pressed={holdTrail} disabled={status !== 'listening'} onClick={() => setHoldTrail(value => !value)}>{holdTrail ? 'Resume' : 'Hold'}</button>
              </div>
            </div>
            <PitchContour points={session ? session.frames : trail} now={session ? replayTimeMs : trailNow} saHz={saHz} centerSemi={pitchView.center} rangeSemis={pitchView.range} onViewChange={changePitchView} seconds={trailSeconds} raga={selectedRaga} nowLabel={session ? 'Playhead' : 'Now'} />
          </section>
          <div className={styles.pitchStrip} aria-label="Current pitch and tuning offset">
            <div className={styles.stripValue}><span>DETECTED PITCH</span><strong>{displayReading ? displayReading.frequency.toFixed(1) : '—'}</strong><small>Hz</small></div>
            <div className={styles.stripValue}><span>SVARA / NOTE</span><strong>{ragaPitch?.label ?? swara?.name ?? '—'}</strong><small>{note?.name ?? '—'}</small></div>
            <div className={styles.stripValue}><span>OFFSET</span><strong>{swara ? `${cents > 0 ? '+' : ''}${cents}` : '—'}</strong><small>¢</small></div>
          </div>
          <SessionPanel session={session} recording={status === 'listening' && sourceMode === 'mic' && recorderRef.current !== null} analyzing={status === 'listening' && sourceMode === 'file'} recordingSupported={recordingSupported} positionMs={replayTimeMs} playing={replayPlaying} onPosition={setReplayTimeMs} onPlaying={setReplayPlaying} saHz={saHz} raga={selectedRaga} />
          {selectedRaga && <div className={`${styles.ragaAlert} ${activeRagaWarning ? styles.ragaAlertActive : ''}`} role="status">{activeRagaWarning ? `OUTSIDE ${selectedRaga.name.toUpperCase()} · ${activeRagaWarning.label} · ${activeRagaWarning.frequency.toFixed(1)} Hz` : `${selectedRaga.name.toUpperCase()} · SCALE CHECK ACTIVE`}</div>}
          <details className={styles.logCard} aria-label="Recent pitches"><summary className={styles.visualHeading}><span className={styles.label}>RECENT PITCHES</span><span>{log.length} RECENT <span className={styles.logChevron}>⌄</span></span></summary><ol className={styles.logList}>{log.length ? log.map((item, index) => { const pitch = selectedRaga ? ragaPitchAtFrequency(item.frequency, saHz, selectedRaga) : null; return <li key={`${item.time}-${index}`} title={item.note}><strong>{pitch?.label ?? swaraForFrequency(item.frequency, saHz).name}</strong><span>{item.frequency.toFixed(1)}</span><span>{item.time}</span></li> }) : <li>Pitch events appear here as you sing or play.</li>}</ol></details>
        </div>
        </div>

        <TanpuraPanel saHz={saHz} />
        <p className={styles.privacyNote}>Audio stays in your browser. Best with one voice or instrument at a time.</p>
      </main>
    </div>
  )
}

export default App
