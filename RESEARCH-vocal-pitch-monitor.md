# Vocal Pitch Monitor detector investigation

Inspected Tadao Yamaoka's Android package `com.tadaoyamaoka.vocalpitchmonitor`, versions 1.5.1 (APK, version code 28) and 1.5.7 (XAPK base APK, version code 36). This is a static analysis of the shipped bytecode, not a claim about unpublished source code.

## Verified package

- Version 1.5.1 APK SHA-256: `8421177fa1b5432f1151bdd77d621adf5e5edd0880985c7424dc979aa9892cd5` (matches APKPure's listing).
- Version 1.5.7 XAPK SHA-256: `48afc425d974b02e6550b85224c1b8f0a75ae2e4a9730fed072ca28ae9701110`.
- Both base APKs use the same Tadao Yamaoka signing certificate for supported version ranges; certificate SHA-256 `26c37675ec22f1c92b0ed213e0efd43903ee1a971ef4578d8e3d3b2fee4d84ad`.
- Downloaded files and decompiled output are in `/private/tmp`, outside the app and source tree.

## Detector in both versions

1. Record at **44,100 Hz**. Keep a circular buffer of **4,096 samples** (~92.9 ms). Run an analysis every **1,470 samples** (~33.3 ms).
2. Apply a Hann window and real FFT. Square each FFT bin's magnitude, then inverse FFT that power spectrum to obtain an **autocorrelation function** (ACF).
3. Gate quiet windows by the square root of zero-lag ACF against an adjustable threshold (default `2.0` in its internally scaled units).
4. Find ACF local maxima over a lag range corresponding roughly to **32.7–4,186 Hz**. Take the strongest local peak, requiring at least half of zero-lag ACF. Its lag yields an initial `44,100 / lag` estimate.
5. Inspect FFT energy close to selected frequencies and related harmonics. Rules can change the estimate by factors of 1/2, 1/3, 2, or 3 to correct octave/harmonic errors. Low spectral evidence can reject a frame.
6. Refine the result using additional ACF peaks at multiple periods. Store an F0 or unvoiced marker for the scrolling pitch trace.

The 1.5.7 detector is obfuscated, but its constants and signal path match the readable 1.5.1 `Analyzer` class. It is an **FFT-based autocorrelation detector with spectral harmonic checks**. The shipped analysis path does not resemble YIN's cumulative mean normalized difference, pYIN's probabilistic Viterbi track, or a neural model. No model weights or inference native libraries were found in the 1.5.7 base APK.

## Implication for Svara

This app's quality does not demonstrate that a neural detector is necessary. A useful independent comparator for our YIN/pYIN/CREPE work would be an ACF candidate stage plus explicit harmonic correction and an unvoiced gate. Benchmark it on our real vocal excerpts and tanpura recordings before choosing a live default. Build our own implementation from the signal-processing ideas rather than copying the app's proprietary code or numeric heuristics.

Sources: [APKPure 1.5.1](https://apkpure.net/vocal-pitch-monitor/com.tadaoyamaoka.vocalpitchmonitor/download/1.5.1), [APKPure 1.5.7](https://apkpure.net/vocal-pitch-monitor/com.tadaoyamaoka.vocalpitchmonitor/download), locally inspected APK bytecode.
