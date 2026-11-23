import { useEffect, useRef, useState } from 'react'
import { TanpuraPlayer, tanpuraFrequencies, type TanpuraFirstString, type TanpuraSettings } from './audio/tanpura'
import styles from './TanpuraPanel.module.css'

export default function TanpuraPanel({ saHz }: { saHz: number }) {
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')
  const [octave, setOctave] = useState<0 | -1>(() => saHz >= 220 ? -1 : 0)
  const [firstString, setFirstString] = useState<TanpuraFirstString>('pa')
  const [volume, setVolume] = useState(35)
  const [pace, setPace] = useState(1.1)
  const playerRef = useRef<TanpuraPlayer | null>(null)
  const settings: TanpuraSettings = { saHz, octave, firstString, volume, pace }
  const frequencies = tanpuraFrequencies(settings)

  useEffect(() => { playerRef.current?.setSettings(settings) }, [saHz, octave, firstString, volume, pace])
  useEffect(() => () => { playerRef.current?.stop(); playerRef.current = null }, [])
  useEffect(() => {
    const hot = import.meta.hot
    const stopForUpdate = () => { playerRef.current?.stop(); playerRef.current = null; setPlaying(false) }
    hot?.on('vite:beforeUpdate', stopForUpdate)
    return () => hot?.off('vite:beforeUpdate', stopForUpdate)
  }, [])

  const toggle = async () => {
    if (playerRef.current) {
      playerRef.current.stop()
      playerRef.current = null
      setPlaying(false)
      return
    }
    setError('')
    const player = new TanpuraPlayer(settings)
    playerRef.current = player
    try {
      await player.start()
      if (playerRef.current === player) setPlaying(true)
    } catch {
      if (playerRef.current === player) playerRef.current = null
      setPlaying(false)
      setError('Could not start tanpura audio. Check your output device and try again.')
    }
  }

  return <section className={styles.panel} aria-label="Tanpura drone">
    <div className={styles.header}>
      <div><span className={styles.eyebrow}>TANPURA</span><p className={styles.description}>Four-string drone · follows reference Sa</p></div>
      <button className={`${styles.playButton} ${playing ? styles.playing : ''}`} type="button" aria-pressed={playing} onClick={toggle}>{playing ? '■ Stop drone' : '▶ Play drone'}</button>
    </div>
    <div className={styles.controls}>
      <label>First string<select aria-label="Tanpura first string" value={firstString} onChange={event => setFirstString(event.target.value as TanpuraFirstString)}><option value="pa">Pa</option><option value="ma">Ma</option><option value="sa">Sa</option></select></label>
      <label>Drone Sa octave<select aria-label="Tanpura Sa octave" value={octave} onChange={event => setOctave(Number(event.target.value) as 0 | -1)}><option value={-1}>One below reference</option><option value={0}>Same as reference</option></select></label>
      <label>Volume <output>{volume}%</output><input aria-label="Tanpura volume" type="range" min="0" max="100" step="1" value={volume} onChange={event => setVolume(Number(event.target.value))} /></label>
      <label>Pluck interval <output>{pace.toFixed(1)} s</output><input aria-label="Tanpura pluck interval" type="range" min="0.7" max="1.6" step="0.1" value={pace} onChange={event => setPace(Number(event.target.value))} /></label>
    </div>
    <div className={styles.footer}><span>STRINGS</span><span>{[firstString === 'pa' ? 'Pa' : firstString === 'ma' ? 'Ma' : 'Sa', 'Sa', 'Sa', 'Sa'].map((label, index) => `${label} ${frequencies[index].toFixed(1)} Hz`).join(' · ')}</span></div>
    <p className={styles.hint}>Use headphones while listening through the microphone to keep the drone out of pitch detection.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>
}
