import { useState } from 'react'
import { JANYA_RAGAS, MELAKARTA_RAGAS, RAGAS, ragaSwaraAtClass, type Raga } from './music/ragas'
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
  const [searchOpen, setSearchOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const search = query.trim().toLowerCase()
  const matches = search ? RAGAS.filter(item => item.name.toLowerCase().includes(search) || String(item.number) === search || String(item.parent) === search)
    .sort((a, b) => {
      const rank = (item: Raga) => item.name.toLowerCase() === search ? 0 : item.name.toLowerCase().startsWith(search) ? 1 : String(item.number) === search ? 2 : item.name.toLowerCase().includes(search) ? 3 : 4
      return rank(a) - rank(b) || a.name.localeCompare(b.name)
    }) : []
  const results = matches.slice(0, 8)
  const choose = (id: string) => { onSelect(id); setQuery(''); setSearchOpen(false); setActiveIndex(0) }
  return <section className={styles.panel} aria-label="Raga guide">
    <div className={styles.header}><span className={styles.eyebrow}>RAGA GUIDE</span><span className={styles.count}>72 MELAKARTA · {JANYA_RAGAS.length} JANYA</span></div>
    <div className={styles.searchWrap} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false) }}>
      <label className={styles.selector}>Find a raga
        <input type="search" value={query} onFocus={() => setSearchOpen(true)} onChange={event => { setQuery(event.target.value); setSearchOpen(true); setActiveIndex(0) }} onKeyDown={event => {
          if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); setActiveIndex(index => (index + 1) % results.length) }
          if (event.key === 'ArrowUp' && results.length) { event.preventDefault(); setActiveIndex(index => (index - 1 + results.length) % results.length) }
          if (event.key === 'Enter' && results.length) { event.preventDefault(); choose(results[activeIndex]?.id ?? results[0].id) }
          if (event.key === 'Escape') setSearchOpen(false)
        }} placeholder="Search name or Mela number" aria-label="Find a raga" role="combobox" aria-autocomplete="list" aria-expanded={searchOpen && !!search} aria-controls="raga-search-results" aria-activedescendant={searchOpen && results.length ? `raga-result-${activeIndex}` : undefined} />
      </label>
      {searchOpen && search && <div className={styles.searchResults} id="raga-search-results" role="listbox" aria-label="Matching ragas">
        <span className={styles.searchCount}>{matches.length ? `${matches.length} match${matches.length === 1 ? '' : 'es'} · select a result` : 'No matching ragas'}</span>
        {results.map((item, index) => <button key={item.id} id={`raga-result-${index}`} type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? styles.activeResult : ''} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(item.id)}><span>{item.name}</span><small>{item.kind === 'melakarta' ? `Melakarta ${item.number}` : `Janya · Mela ${item.parent}`}</small></button>)}
        {matches.length > results.length && <span className={styles.searchCount}>Showing first {results.length}; refine your search.</span>}
      </div>}
    </div>
    <label className={styles.selector}>Selected raga
      <select aria-label="Selected raga" value={raga?.id ?? ''} onChange={event => choose(event.target.value)}>
        <option value="">Off — no scale check</option>
        <optgroup label="Janya ragas">{JANYA_RAGAS.map(item => <option key={item.id} value={item.id}>{item.name} · Mela {item.parent}</option>)}</optgroup>
        <optgroup label="72 Melakarta ragas">{MELAKARTA_RAGAS.map(item => <option key={item.id} value={item.id}>{item.number}. {item.name}</option>)}</optgroup>
      </select>
    </label>
    {raga ? <>
      <div className={styles.scale}><span>ASC</span><strong>{raga.ascending.join(' ')}</strong><span>DESC</span><strong>{raga.descending.join(' ')}</strong></div>
      <div className={styles.swaras}><span>IN SCALE</span><div>{raga.pitchClasses.map(semitone => <span className={styles.allowed} key={semitone}>{ragaSwaraAtClass(raga, semitone)}</span>)}</div></div>
      <div className={styles.swaras}><span>OUTSIDE</span><div>{Array.from({ length: 12 }, (_, i) => i).filter(semitone => !raga.pitchClasses.includes(semitone)).map(semitone => <span className={styles.excluded} key={semitone}>{SHORT_SWARAS[semitone]}</span>)}</div></div>
      <div className={styles.activity}>
        {warning ? <div className={styles.warning} role="status">OUTSIDE {raga.name.toUpperCase()} · {warning.label} · {warning.frequency.toFixed(1)} Hz</div>
          : events.length > 0 ? <div className={styles.events}><span>RECENT OUTSIDE NOTES</span>{events.slice(0, 3).map((event, index) => <div key={`${event.time}-${index}`}><strong>{event.label}</strong><span>{event.frequency.toFixed(1)} Hz</span><time>{event.time}</time></div>)}</div>
            : <div className={styles.events}>No outside notes yet.</div>}
      </div>
      <p className={styles.note}>Checks sustained equal-tempered pitch positions only. Brief gamaka crossings are ignored; a scale alone does not define every allowed raga phrase.</p>
    </> : <p className={styles.note}>Choose a raga to mark pitches outside its scale while listening.</p>}
  </section>
}
