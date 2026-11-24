import { SHORT_SWARAS } from '../audio/pitch'
import janyaCatalog from './janya-ragas.json'

export type Raga = {
  id: string
  name: string
  kind: 'melakarta' | 'janya'
  number?: number
  parent?: number
  ascending: string[]
  descending: string[]
  pitchClasses: number[]
}

const pitchClass: Record<string, number> = {
  S: 0, R1: 1, R2: 2, R3: 3, G1: 2, G2: 3, G3: 4,
  M1: 5, M2: 6, P: 7, D1: 8, D2: 9, D3: 10, N1: 9, N2: 10, N3: 11,
}
const lowerPairs = [
  ['R1', 'G1'], ['R1', 'G2'], ['R1', 'G3'],
  ['R2', 'G2'], ['R2', 'G3'], ['R3', 'G3'],
]
const upperPairs = [
  ['D1', 'N1'], ['D1', 'N2'], ['D1', 'N3'],
  ['D2', 'N2'], ['D2', 'N3'], ['D3', 'N3'],
]

const melaNames = [
  'Kanakangi', 'Ratnangi', 'Ganamurti', 'Vanaspati', 'Manavati', 'Tanarupi',
  'Senavati', 'Hanumatodi', 'Dhenuka', 'Natakapriya', 'Kokilapriya', 'Rupavati',
  'Gayakapriya', 'Vakulabharanam', 'Mayamalavagowla', 'Chakravakam', 'Suryakantam', 'Hatakambari',
  'Jhankaradhwani', 'Natabhairavi', 'Keeravani', 'Kharaharapriya', 'Gowrimanohari', 'Varunapriya',
  'Mararanjani', 'Charukesi', 'Sarasangi', 'Harikambhoji', 'Dheera Shankarabharanam', 'Naganandini',
  'Yagapriya', 'Ragavardhini', 'Gangeyabhushani', 'Vagadheeswari', 'Shulini', 'Chalanattai',
  'Salagam', 'Jalarnavam', 'Jhalavarali', 'Navaneetam', 'Pavani', 'Raghupriya',
  'Gavambodhi', 'Bhavapriya', 'Shubhapantuvarali', 'Shadvidamargini', 'Suvarnangi', 'Divyamani',
  'Dhavalambari', 'Namanarayani', 'Kamavardhini', 'Ramapriya', 'Gamanashrama', 'Vishwambhari',
  'Shyamalangi', 'Shanmukhapriya', 'Simhendramadhyamam', 'Hemavati', 'Dharmavati', 'Neetimati',
  'Kantamani', 'Rishabhapriya', 'Latangi', 'Vachaspati', 'Mechakalyani', 'Chitrambari',
  'Sucharitra', 'Jyotiswarupini', 'Dhatuvardani', 'Nasikabhushani', 'Kosalam', 'Rasikapriya',
]

function createRaga(id: string, name: string, kind: Raga['kind'], ascending: string[], descending: string[], number?: number, parent?: number): Raga {
  return {
    id, name, kind, number, parent, ascending, descending,
    pitchClasses: [...new Set([...ascending, ...descending].map(swara => pitchClass[swara]))].sort((a, b) => a - b),
  }
}

export const MELAKARTA_RAGAS: Raga[] = melaNames.map((name, index) => {
  const number = index + 1
  const chakra = Math.floor(index % 36 / 6)
  const [ri, ga] = lowerPairs[chakra]
  const [dha, ni] = upperPairs[index % 6]
  const ma = number <= 36 ? 'M1' : 'M2'
  const ascending = ['S', ri, ga, ma, 'P', dha, ni, 'S']
  return createRaga(`mela-${number}`, name, 'melakarta', ascending, [...ascending].reverse(), number)
})

export const JANYA_RAGAS: Raga[] = janyaCatalog.map(item =>
  createRaga(item.id, item.name, 'janya', item.ascending, item.descending, undefined, item.parent),
)

export const RAGAS = [...JANYA_RAGAS, ...MELAKARTA_RAGAS]

export function ragaSwaraAtClass(raga: Raga, semitone: number): string | null {
  const normalized = ((semitone % 12) + 12) % 12
  return [...raga.ascending, ...raga.descending].find(swara => pitchClass[swara] === normalized) ?? null
}

export function ragaPitchAtFrequency(frequency: number, saHz: number, raga: Raga) {
  const semitones = 12 * Math.log2(frequency / saHz)
  const nearest = Math.round(semitones)
  const normalized = ((nearest % 12) + 12) % 12
  return {
    semitone: normalized,
    cents: Math.round((semitones - nearest) * 100),
    allowed: raga.pitchClasses.includes(normalized),
    label: ragaSwaraAtClass(raga, normalized) ?? SHORT_SWARAS[normalized].replaceAll('₁', '1').replaceAll('₂', '2').replaceAll('₃', '3'),
  }
}
