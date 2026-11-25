import { useEffect, useRef, useState } from 'react'
import { type Raga } from './music/ragas'
import { pitchCsv, type SessionData } from './audio/session'
import styles from './SessionPanel.module.css'

type Props = {
  session: SessionData | null
  recording: boolean
  analyzing: boolean
  recordingSupported: boolean
  positionMs: number
  playing: boolean
  onPosition: (timeMs: number) => void
  onPlaying: (playing: boolean) => void
  saHz: number
  raga: Raga | null
}

function timeLabel(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export default function SessionPanel({ session, recording, analyzing, recordingSupported, positionMs, playing, onPosition, onPlaying, saHz, raga }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState(0)
  const [playError, setPlayError] = useState('')

  useEffect(() => {
    if (!session) { setAudioUrl(null); setDurationMs(0); return }
    const url = URL.createObjectURL(session.audio)
    setAudioUrl(url)
    setDurationMs(session.durationMs)
    setPlayError('')
    return () => URL.revokeObjectURL(url)
  }, [session])

  const togglePlayback = async () => {
    const audio = audioRef.current
    if (!audio || !session) return
    if (!audio.paused) { audio.pause(); return }
    if (audio.currentTime * 1000 >= durationMs - 100) audio.currentTime = 0
    try { await audio.play(); setPlayError('') }
    catch { setPlayError('Could not replay this audio in this browser.') }
  }

  const seek = (timeMs: number) => {
    const audio = audioRef.current
    if (audio) audio.currentTime = timeMs / 1000
    onPosition(timeMs)
  }

  const csvName = session ? session.audioName.replace(/\.[^.]+$/, '') + '-pitch.csv' : 'svara-pitch.csv'

  return <section className={styles.panel} aria-label="Session replay">
    <div className={styles.heading}><span>SESSION REPLAY</span><span>{recording ? '● CAPTURING' : analyzing ? '● ANALYZING' : session ? `${session.source === 'mic' ? 'MIC' : 'FILE'} · ${timeLabel(durationMs)}` : 'LOCAL SESSION'}</span></div>
    {session && audioUrl ? <>
      <audio ref={audioRef} src={audioUrl} preload="metadata" onLoadedMetadata={event => { const duration = event.currentTarget.duration; if (Number.isFinite(duration) && duration > 0) setDurationMs(duration * 1000) }} onTimeUpdate={event => onPosition(event.currentTarget.currentTime * 1000)} onSeeked={event => onPosition(event.currentTarget.currentTime * 1000)} onPlay={() => onPlaying(true)} onPause={() => onPlaying(false)} onEnded={() => { onPlaying(false); onPosition(durationMs) }} />
      <div className={styles.transport}>
        <button type="button" onClick={togglePlayback} aria-label={playing ? 'Pause session replay' : 'Play session replay'}>{playing ? '❚❚ Pause' : '▶ Replay'}</button>
        <span>{timeLabel(positionMs)}</span>
        <input type="range" aria-label="Session playhead" min="0" max={Math.max(1, Math.round(durationMs))} step="10" value={Math.min(positionMs, durationMs)} onChange={event => seek(Number(event.target.value))} />
        <span>{timeLabel(durationMs)}</span>
      </div>
      <div className={styles.actions}><span>Change Sa or raga while replaying.</span><button type="button" onClick={() => download(session.audio, session.audioName)}>Export audio</button><button type="button" onClick={() => download(new Blob([pitchCsv(session.frames, saHz, raga)], { type: 'text/csv;charset=utf-8' }), csvName)}>Export pitch CSV</button></div>
      {playError && <p className={styles.error} role="alert">{playError}</p>}
    </> : <p className={styles.empty}>{recording ? 'Recording the full take. Stop listening to replay and export it.' : analyzing ? 'Analyzing this file. Replay and export appear when it finishes.' : recordingSupported ? 'Start listening to record a take, or analyze an audio file.' : 'This browser can analyze audio but cannot record a microphone session.'}</p>}
  </section>
}
