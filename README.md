# Svara Live

A local, browser-based sound lab for live pitch detection. This is the first stage toward svara and raga identification.

## Run

```sh
bun install
bun run dev
```

Open the URL Vite prints (normally [http://localhost:5173](http://localhost:5173)). Choose **Microphone** for live input or **Audio file** to play and analyze a local recording. File playback does not need microphone permission. For a production bundle, run `bun run build`. Run detector checks with `bun test`.

The input source and listening control are in the top bar. The pitch contour is the primary panel, with a compact live pitch, svara/note, and cents strip directly below it. Detector, reference Sa, tuner, level, and threshold controls sit in a separate settings area. Type any Sa frequency from 50–1000 Hz, or choose an octave and a C, D, G, or A preset.

The bottom Tanpura panel plays a synthesized four-string drone through Web Audio. It follows the current reference Sa and lets you choose Pa, Ma, or Sa for the first string, the drone octave, volume, and pluck interval. The drone has its own audio context and is not fed into the detector; use headphones when using the microphone so speaker sound does not bleed back into the input.

The raga guide includes 72 Melakarta ragas and 899 janya ragas. Search by name or Melakarta number, then choose a raga to mark pitch positions outside its scale on the contour and in a short event list. It waits about 220 ms on a pitch within 30 cents of a scale position before warning, so brief gamaka crossings do not trigger. Janya pitch sets use the union of each cataloged ascending and descending scale; a note present in either direction is allowed. This is a pitch-set check, not full raga grammar or raga identification. Gamakas, phrases, and permitted foreign notes can make a scale-only warning misleading.

The Melakarta names and swaras follow the [Swaraa and Thaalaa academy chart](https://swaraathaalaa.com/72melakartachart/) and the [Kerala music textbook](https://samagra.kite.kerala.gov.in/files/samagra-resource/uploads/tbookscmq/Class_XI/Music/Music.pdf). The janya catalog is adapted from the MIT-licensed [PyCarnatic `raaga_list_full.inp`](https://github.com/naturalstupid/PyCarnatic/blob/master/carnatic/config/raaga_list_full.inp), with its [license notice](THIRD_PARTY_NOTICES.md). Two source entries with invalid note tokens (`Pn3` and `M3`) are excluded, leaving 899 of the source's 901 janya entries. This is a substantial catalog, not an exhaustive list of all janya ragas or variants.

For a quiet microphone, the detection settings include live input gain and browser automatic gain. Android starts at 4× input gain; other devices start at 1×. The minimum level defaults to 0.001 RMS. Raising input gain also raises room noise. Android browsers must have both app and site microphone permission, and a phone needs HTTPS or its own `localhost` to use the mic. For local phone testing over USB, `adb reverse tcp:5174 tcp:5174` exposes a local Vite server as `http://localhost:5174` on the phone.

While listening, the app requests a screen wake lock when supported. If the browser suspends audio when the page becomes hidden, the app attempts to resume it when the page is visible again.

## Stack and signal path

- **Bun + Vite + React + TypeScript** for a small, fast local app.
- **CSS Modules** for scoped styles, with a saved dark/light setting and mobile layouts.
- **Web Audio API** analyzes microphone samples or a locally selected audio file through the same waveform, spectrum, and pitch pipeline. Files are decoded and played in the browser; no audio is uploaded or recorded by the app.
- **FFT autocorrelation, our YIN, Essentia YIN, and Essentia YIN FFT** are selectable from one algorithm dropdown. Only the selected detector runs in a Web Worker, about every 50 ms. Autocorrelation is the default. Essentia's frame-based algorithms load lazily as WebAssembly on first use; [Essentia.js is AGPLv3](https://github.com/MTG/essentia.js/blob/master/LICENSE). PitchYinFFT can still make octave errors on some vocal frames, even with high confidence. The autocorrelation path checks spectral harmonics to help resolve octave errors. The analyser window tracks roughly 85 ms across common sample rates. A silence gate and three-reading median reduce false and jumpy contour readings. The default pitch range is 75–1000 Hz.
- Detection settings let you adjust minimum signal level, YIN threshold, autocorrelation minimum, Essentia minimum confidence, and pitch range while listening.
- Choose Auto, 44.1, 48, or 96 kHz before starting. The app requests that microphone rate when the browser supports the constraint, sets the Web Audio analysis rate, and reports both actual rates. The browser may resample a microphone that cannot provide the requested rate.
- The compact workspace puts a continuous 8/16/30-second pitch contour against Carnatic svara rows and their reference frequencies. Its default vertical view spans one octave below Sa through two octaves above Sa. Drag vertically to move the pitch view, pinch on touchscreens or scroll over the plot to zoom, or use the octave and zoom buttons; the range can cover one to five octaves. Panning stops one octave beyond the configured detector pitch limits. Optional Auto-follow shifts the chart when a detected pitch approaches an edge; manual pan or zoom turns it off. Hold freezes the contour for inspection. Waveform and spectrum are hidden by default and available through **Show scopes**.
- The input RMS meter updates independently of pitch detection to show whether audio is reaching the app. All detectors can be misled by accompaniment or chords.
- [`public/c-sa-harmonics.wav`](public/c-sa-harmonics.wav) is a synthetic 8-second C3 (130.81 Hz) reference with stronger overtones than the fundamental. It is a repeatable file-mode check, not a real tanpura recording.
- The detected frequency maps to a Western note and a **provisional equal-tempered svara** relative to the configurable Sa. Raga identification needs a later melodic-context stage; a single frequency cannot identify a raga.

Best results come from one sustained voice or instrument at a time in a quiet room. Microphone access works on localhost or HTTPS.
