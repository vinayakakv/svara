# Riyaz pitch-detector investigation

Inspected MusicMuni Labs' Android package `com.musicmuni.riyaz`, version `2026.11.05` (version code 1242). This is static inspection of the shipped package, not unpublished source or a runtime trace of every screen.

## Package verification

- XAPK SHA-256: `8efd00116cf6c1115c3d09841638a1a53a74f06edf6cf15610e060c31a82983a`, matching the [APKPure listing](https://apkpure.net/riyaz-practice-learn-to-sing/com.musicmuni.riyaz/download).
- Base APK package and version match [Google Play](https://play.google.com/store/apps/details?id=com.musicmuni.riyaz).
- App signing certificate SHA-1: `ad7f52ed2e3b93f8e8ecc8e441767ec779d5f6e2`, matching APKPure's listing.
- Downloaded package and decompiled files remain in `/private/tmp`.

## What the package shows

- The real-time pitch API supports four named algorithms: `YIN`, `SWIFT_F0`, `MELODIA`, and `PYIN`. The default `PitchDetectorConfig` selects **YIN**. Decompiled live call sites for a practice session and a speaking-pitch flow construct YIN detectors. The vocal monitor screen's exact call chain is harder to prove because app classes are obfuscated, so these findings do not establish every screen's runtime choice.
- Default balanced pitch settings appear to use **16 kHz audio, 1,024-sample windows (~64 ms), 160-sample hops (~10 ms), 80–1,000 Hz range**, a `−40 dB` amplitude gate, and a 0.75 detection threshold/confidence value. The native implementation determines how those thresholds are applied; they should not be equated directly with our YIN CMNDF threshold.
- One live practice path explicitly enables **five-reading smoothing and octave correction**. The library's processing configuration exposes a 150-cent octave/jump threshold. Other YIN call sites do not necessarily enable this processing.
- The package has two native libraries: `libvoxatrace.so` and `libvoxatrace-ai.so`. The former exports the JNI pitch detector and includes Essentia `PitchYinFFT` and `PredominantPitchMelodia` symbols. Bundling those algorithms alone does not prove that the live monitor calls them.
- `libvoxatrace-ai.so` contains ONNX Runtime and a `SwiftF0` neural pitch API. The model loader looks for a `swift_f0.onnx` file in app storage. No such model was found in this APK bundle. SwiftF0 is a supported path, but its availability and use depend on model provision.
- The offline contour-extraction API defaults to `SWIFT_F0` and exposes `MELODIA` and `PYIN` alternatives. This is distinct from the traced real-time YIN call sites.

## Implication for Svara

Riyaz is useful evidence that a responsive YIN path with a short hop, explicit voicing gate, and selective pitch processing can support polished real-time feedback. Our current YIN comparison uses roughly 85 ms windows and 50 ms updates. A fair next benchmark would vary hop/window and evaluate voiced continuity, octave errors, latency, and glide fidelity on the same vocal recordings before adopting any smoothing. The current app keeps autocorrelation as its default while YIN remains selectable.

The Riyaz `.so` files are Android native binaries and cannot run directly in this browser app. Private local use does not make their code open source. For a browser-compatible implementation of other pitch algorithms, [Essentia.js](https://github.com/MTG/essentia.js) supplies WebAssembly algorithms under [AGPLv3](https://github.com/MTG/essentia.js/blob/master/LICENSE). Svara's algorithm dropdown lists only the detectors currently implemented and running here.

## Native algorithm inventory and call path

`libvoxatrace.so` is a stripped ARM64 ELF library. Its exported JNI names include `PitchDetectorJni_create/detect`, `MelodiaJni_create/process`, and FFT magnitude processing. The embedded Essentia code identifies `PitchYinFFT` and `PredominantPitchMelodia`, and includes KissFFT and FFTW. This proves those algorithms are packaged, not which one the live screen selects.

The Java/Kotlin wrapper gives a clearer path: `PitchDetection.createDetector()` maps **YIN** to a native `PitchDetectorJni` wrapper; **SwiftF0** to a separate ONNX-backed native model; and rejects **MELODIA** and **PYIN** as batch/offline-only for this real-time factory. The YIN wrapper converts audio to little-endian signed 16-bit PCM, calls JNI with buffer size, tolerance, min/max frequencies, and sample rate, then receives pitch and confidence. Its exact internal YIN difference/CMNDF and interpolation code cannot be confirmed from the stripped binary alone.

The offline contour extractor has separate YIN, SwiftF0, MELODIA, and pYIN routes. pYIN has configuration for multiple thresholds, beta distribution parameters, pitch resolution, transition rate, and voicing switch probability; it is not merely a smoothed YIN output. `libvoxatrace-ai.so` exports SwiftF0 JNI inference and embeds ONNX Runtime, but the inspected APK contains no `swift_f0.onnx` model.

The default real-time detector configuration names YIN with a 1,024-sample buffer, 160-sample hop, 80–1,000 Hz range, −40 dB amplitude gate, 0.75 confidence threshold, optional five-reading smoothing, and optional octave correction. Those processing options are disabled in the base config and enabled explicitly by some call sites. These values come from the app wrapper, not a runtime trace of the live monitor screen.

## Connected Android phone check (2026-11-23)

- ADB sees a connected A069 phone running Android 17 with Riyaz `2026.11.20` (version code 1244) installed. Its installed base and ARM64 split APKs contain `libvoxatrace.so` and `libvoxatrace-ai.so`, but no `.onnx` or `.tflite` model files.
- The model loader constructs its path as the app's private `files/voxatrace-models/swift_f0.onnx`. The app is not debuggable, `run-as` fails, the shell has no root access, and Android denies listing `/data/user/0/com.musicmuni.riyaz/files`. Therefore the presence or absence of a separately downloaded model in that private directory is **unverified**.
- The accessible external app `files` directory is empty. With a Sarale Varase pitch exercise open and running, recent system/app logs showed no SwiftF0 or model download/load messages. This is not proof that the private model is absent or unused; the app may not log those events.

Sources: [Riyaz official site](https://riyazapp.com/), [Google Play listing](https://play.google.com/store/apps/details?id=com.musicmuni.riyaz), [APKPure package listing](https://apkpure.net/riyaz-practice-learn-to-sing/com.musicmuni.riyaz/download), local static package inspection.
