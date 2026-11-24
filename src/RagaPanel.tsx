import { useState } from 'react'
import { JANYA_RAGAS, MELAKARTA_RAGAS, ragaSwaraAtClass, type Raga } from './music/ragas'
import { SHORT_SWARAS } from './audio/pitch'
import styles from './RagaPanel.module.css'

export type RagaEvent = { label: string; frequency: number; time: string }

export default function RagaPanel({ raga, onSelect, warning, events }: {
  raga: Raga | null
  onSelect: (id: string) => void
  warning: RagaEvent | null
  events: RagaEvent[]
}) {
  const [query, setQuery] = useState('')
  const search = query.trim().toLowerCase()
  const visibleJanya = JANYA_RAGAS.filter(item => item.id === raga?.id || item.name.toLowerCase().includes(search) || String(item.parent) === search)
  const visibleMela = MELAKARTA_RAGAS.filter(item => item.id === raga?.id || item.name.toLowerCase().includes(search) || String(item.number) === search)
  return <section className={styles.panel} aria-label="Raga guide">
    <div className={styles.header}><span className={styles.eyebrow}>RAGA GUIDE</span><span className={styles.count}>72 MELAKARTA · {JANYA_RAGAS.length} JANYA</span></div>
    <label className={styles.selector}>Find a raga
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or Melakarta number" aria-label="Find a raga" />
    </label>
    <label className={styles.selector}>Selected raga
      <select aria-label="Selected raga" value={raga?.id ?? ''} onChange={event => { onSelect(event.target.value); setQuery('') }}>
        <option value="">Off — no scale check</option>
        {visibleJanya.length > 0 && <optgroup label="Janya ragas">{visibleJanya.map(item => <option key={item.id} value={item.id}>{item.name} · Mela {item.parent}</option>)}</optgroup>}
        {visibleMela.length > 0 && <optgroup label="72 Melakarta ragas">{visibleMela.map(item => <option key={item.id} value={item.id}>{item.number}. {item.name}</option>)}</optgroup>}
        {visibleJanya.length + visibleMela.length === 0 && <option disabled>No matching ragas</option>}
      </select>
    </label>
    {raga ? <>
      <div className={styles.scale}><span>ASC</span><strong>{raga.ascending.join(' ')}</strong><span>DESC</span><strong>{raga.descending.join(' ')}</strong></div>
      <div className={styles.swaras}><span>IN SCALE</span><div>{raga.pitchClasses.map(semitone => <span className={styles.allowed} key={semitone}>{ragaSwaraAtClass(raga, semitone)}</span>)}</div></div>
      <div className={styles.swaras}><span>OUTSIDE</span><div>{Array.from({ length: 12 }, (_, i) => i).filter(semitone => !raga.pitchClasses.includes(semitone)).map(semitone => <span className={styles.excluded} key={semitone}>{SHORT_SWARAS[semitone]}</span>)}</div></div>
      {warning && <div className={styles.warning} role="status">OUTSIDE {raga.name.toUpperCase()} · {warning.label} · {warning.frequency.toFixed(1)} Hz</div>}
      {events.length > 0 && <div className={styles.events}><span>RECENT OUTSIDE NOTES</span>{events.slice(0, 3).map((event, index) => <div key={`${event.time}-${index}`}><strong>{event.label}</strong><span>{event.frequency.toFixed(1)} Hz</span><time>{event.time}</time></div>)}</div>}
      <p className={styles.note}>Checks sustained equal-tempered pitch positions only. Brief gamaka crossings are ignored; a scale alone does not define every allowed raga phrase.</p>
    </> : <p className={styles.note}>Choose a raga to mark pitches outside its scale while listening.</p>}
  </section>
}
