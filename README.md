# Interval

An ambient sound environment synthesized entirely in the browser — evolving tones generated from scratch using the Web Audio API, with no audio files.

## What it does

Interval is a generative ambient sound engine. Every sound you hear is synthesized in real time from oscillators, filters, and envelopes. The sound evolves slowly on its own without requiring interaction. Nothing is recorded or streamed.

## How the synthesis works

_(For developers who haven't used the Web Audio API before.)_

The Web Audio API lets you build a signal chain in JavaScript — a graph of nodes where audio flows from sources to a destination (your speakers). Interval uses:

**Five oscillators** — three `sine` and two `triangle` — each tuned to a specific harmonic ratio anchored at A1 (55 Hz). Sine waves produce only a pure fundamental tone (no overtones), creating warmth. Triangle waves add a small amount of harmonic content above the fundamental, adding presence without brightness.

**A lowpass filter** (`BiquadFilterNode`) strips away frequencies above a slowly moving cutoff point. This keeps the sound dark and intimate.

**Reverb** via `ConvolverNode`, using an impulse response (IR) generated algorithmically at runtime — exponentially decaying noise mixed with the dry signal. No audio file is read. The IR is an `AudioBuffer` created and filled with JavaScript.

**LFOs (Low Frequency Oscillators)** — additional `OscillatorNode` instances running at sub-audio speeds (one cycle every 47–110 seconds). These are connected directly to `AudioParam` objects (gain values, filter cutoff, stereo pan) via the Web Audio API's modulation graph, so they run on the audio thread without JavaScript polling.

**Autonomous evolution** — because all LFO periods are mutually prime numbers, no two LFOs ever synchronize within a 5-minute window. The combination of drifting amplitudes, filter sweeps, pitch micro-wobble, and stereo pan movement means the sound never repeats.

All parameter changes use `linearRampToValueAtTime` or `exponentialRampToValueAtTime` — the gain is never set directly on a live node, which guarantees zero clicks or pops.

## How Interval differs from Resonance

Resonance reads audio **output** via `AnalyserNode` — it performs FFT analysis on the signal leaving the speakers and drives visuals from frequency data. The visuals are reactive: they respond to sound.

Interval drives visuals from synthesis **input parameters** — the LFO configuration, filter settings, and rate multiplier. The orb element's breathing period is computed from the rate parameter and filter LFO period; it would animate identically with the audio muted. The visuals are generative: they reflect the system's intent, not its output.

No `AnalyserNode` is used anywhere in Interval.

## Moods

| Mood       | Harmonic character                       | Filter                          |
| ---------- | ---------------------------------------- | ------------------------------- |
| **Still**  | Pythagorean ratios (root, fifth, octave) | Warmer, lower cutoff range      |
| **Open**   | Major third, suspended intervals         | Moderate cutoff range           |
| **Uneasy** | Minor second + tritone (√2 ratio)        | Colder, higher Q, resonant edge |

## Setup

```bash
npm install
```

No build step. Open `index.html` in a browser or serve from any static file server.

```bash
# Example with Node
npx serve .
```

The pre-commit hook runs Prettier, ESLint, and Stylelint on staged files via Husky + lint-staged.

## Browser compatibility

Chrome 120+, Firefox 121+, Safari 17+. Targets the last 2 major versions of evergreen browsers.

AudioContext requires a user gesture to start — a browser autoplay policy requirement. The "begin" button serves as the gesture gate.

## Controls

| Control           | What it does                                                |
| ----------------- | ----------------------------------------------------------- |
| **begin**         | Initializes audio and starts synthesis                      |
| **mute / unmute** | Ramps master gain to silence and back. Keyboard: `M`        |
| **mood**          | Changes harmonic ratios and filter character over 6 seconds |
| **density**       | Controls reverb mix and texture oscillator prominence       |
| **rate**          | Global LFO speed multiplier (0.25× to 2.0×)                 |
| **stop**          | Fades out and resets to the initial state                   |

## No audio files

Interval uses zero audio files. All sound sources are `OscillatorNode` instances. The reverb impulse response is generated at runtime as an `AudioBuffer`. This is a deliberate constraint: the project exists to demonstrate audio synthesis, not audio playback.
