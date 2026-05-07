/**
 * INTERVAL — Audio Synthesis Engine
 * ==================================
 *
 * SIGNAL CHAIN
 * ------------
 *
 * DRONE LAYER — 3 sine oscillators
 *   Sine waves contain only the fundamental frequency. Zero harmonics.
 *   This produces warmth without brightness — tones felt as much as heard.
 *
 *   oscA [sine, root]          → gainA [center + LFO_A, T=47s] ─┐
 *   oscB [sine, fifth]         → gainB [center + LFO_B, T=61s] ─┤
 *   oscC [sine, octave+detune] → gainC [center + LFO_C, T=83s] ─┤
 *
 * TEXTURE LAYER — 2 triangle oscillators
 *   Triangle waves add odd harmonics (1, 1/9, 1/25...) at low amplitude.
 *   Adds shimmer and presence above the drone without harshness.
 *
 *   oscD [triangle, upper]     → gainD [center + LFO_D, T=71s]  ─┤
 *   oscE [triangle, high]      → gainE [center + LFO_E, T=110s] ─┘
 *                                                                  │
 *                                                  ▼               │
 *                                    BiquadFilterNode (lowpass)    │
 *                                    type: lowpass                 │
 *                                    cutoff: mood-range via LFO    │
 *                                    cutoff LFO period: 73s        │
 *                                    Q: mood-dependent             │
 *                                                  │               │
 *                            ┌─────────────────────┤               │
 *                            │                     │               │
 *                    gainDry (0.65)         gainSend (density)     │
 *                            │                     │               │
 *                            │           ConvolverNode (reverb)    │
 *                            │           IR: generated at runtime  │
 *                            │           No audio file used        │
 *                            │                     │               │
 *                            │           gainWet (density × 0.7)  │
 *                            │                     │               │
 *                            └──────────┬───────────┘               │
 *                                       │            ◄──────────────┘
 *                                gainMaster (0.4, mute ramp target)
 *                                       │
 *                              StereoPannerNode
 *                              pan LFO: T=97s, depth ±0.3
 *                                       │
 *                            AudioContext.destination
 *
 * LFO STRATEGY
 * ------------
 * All LFOs are OscillatorNodes connected through GainNodes to AudioParams.
 * This runs entirely on the audio thread — no JavaScript polling.
 * LFO periods are mutually prime numbers to prevent synchronized cycling.
 * At 5 minutes (300s), no two LFOs have completed a synchronized cycle.
 *
 * GAIN RAMPING POLICY
 * -------------------
 * Every amplitude change uses linearRampToValueAtTime or
 * exponentialRampToValueAtTime with a minimum 50ms ramp. The gain value
 * is never set directly on a live node. This guarantees zero clicks or pops
 * under any circumstances: start, stop, mute, mood change, or parameter edit.
 *
 * MOOD SYSTEM
 * -----------
 * Three moods define harmonic ratios anchored at A1 (55 Hz), the filter
 * center frequency and LFO depth, and the filter Q. On mood change, all
 * oscillator frequencies and filter parameters crossfade over 6 seconds.
 */

const ROOT_HZ = 55;
const MASTER_GAIN = 0.4;
const FADE_IN_SEC = 3.0;
const FADE_OUT_SEC = 2.0;
const MUTE_RAMP_SEC = 0.1;
const MOOD_CROSSFADE_SEC = 6.0;

const MOODS = {
  still: {
    ratios: [1, 1.5, 2.0, 3.0, 4.0],
    detunes: [0, 0, 4, 0, 0],
    filterCenter: 550,
    filterDepth: 350,
    filterQ: 2.0,
  },
  open: {
    ratios: [1, 1.25, 1.875, 2.5, 3.75],
    detunes: [0, 0, 0, 0, 0],
    filterCenter: 850,
    filterDepth: 550,
    filterQ: 1.8,
  },
  uneasy: {
    ratios: [1, 1.125, 1.4142, 2.0, 2.8284],
    detunes: [0, 0, 0, 0, 0],
    filterCenter: 1150,
    filterDepth: 650,
    filterQ: 3.5,
  },
};

const OSC_TYPES = ['sine', 'sine', 'sine', 'triangle', 'triangle'];

// LFO periods (seconds) — chosen as mutually prime to avoid repetition
const AMP_PERIODS = [47, 61, 83, 71, 110];
const FREQ_PERIODS = [53, 67, 89]; // drone oscillators only
const FILTER_PERIOD = 73;
const PAN_PERIOD = 97;

// Amplitude envelope: base gain ± LFO depth
const AMP_CENTERS = [0.4, 0.3, 0.3, 0.2, 0.15];
const AMP_DEPTHS = [0.2, 0.2, 0.15, 0.1, 0.1];
const FREQ_DEPTHS = [50, 70, 50]; // cents

// Module-scoped state — not exported directly
let ctx = null;
let nodes = {};
let lfoNodes = {};
let stopTimeout = null;

// Exported state — visual.js reads this to drive the orb
export const synthState = {
  isPlaying: false,
  isMuted: false,
  startTime: 0,
  mood: 'still',
  rateMultiplier: 1.0,
  density: 0.5,
};

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export function start(mood = 'still') {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
  }
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  if (stopTimeout !== null) {
    clearTimeout(stopTimeout);
    stopTimeout = null;
  }

  _teardown();
  _buildGraph(mood);

  synthState.isPlaying = true;
  synthState.isMuted = false;
  synthState.startTime = ctx.currentTime;
  synthState.mood = mood;
}

export function stop() {
  if (!ctx || !synthState.isPlaying) return;

  const now = ctx.currentTime;
  const currentGain = nodes.gainMaster ? nodes.gainMaster.gain.value : 0;

  if (nodes.gainMaster) {
    nodes.gainMaster.gain.cancelScheduledValues(now);
    nodes.gainMaster.gain.setValueAtTime(currentGain, now);
    nodes.gainMaster.gain.linearRampToValueAtTime(0.0001, now + FADE_OUT_SEC);
  }

  synthState.isPlaying = false;

  stopTimeout = setTimeout(
    () => {
      _teardown();
      stopTimeout = null;
    },
    (FADE_OUT_SEC + 0.2) * 1000,
  );
}

export function mute() {
  if (!ctx || !nodes.gainMaster) return;
  const now = ctx.currentTime;
  nodes.gainMaster.gain.cancelScheduledValues(now);
  nodes.gainMaster.gain.setValueAtTime(nodes.gainMaster.gain.value, now);
  nodes.gainMaster.gain.linearRampToValueAtTime(0.0001, now + MUTE_RAMP_SEC);
  synthState.isMuted = true;
}

export function unmute() {
  if (!ctx || !nodes.gainMaster) return;
  const now = ctx.currentTime;
  nodes.gainMaster.gain.cancelScheduledValues(now);
  nodes.gainMaster.gain.setValueAtTime(0.0001, now);
  nodes.gainMaster.gain.exponentialRampToValueAtTime(MASTER_GAIN, now + MUTE_RAMP_SEC);
  synthState.isMuted = false;
}

export function setMood(newMood) {
  if (!ctx || !nodes.oscs || newMood === synthState.mood) return;

  const m = MOODS[newMood];
  const now = ctx.currentTime;
  const end = now + MOOD_CROSSFADE_SEC;

  nodes.oscs.forEach((osc, i) => {
    const target = ROOT_HZ * m.ratios[i];
    osc.frequency.cancelScheduledValues(now);
    osc.frequency.setValueAtTime(osc.frequency.value, now);
    osc.frequency.exponentialRampToValueAtTime(target, end);
  });

  // Filter center crossfade
  nodes.filter.frequency.cancelScheduledValues(now);
  nodes.filter.frequency.setValueAtTime(nodes.filter.frequency.value, now);
  nodes.filter.frequency.exponentialRampToValueAtTime(m.filterCenter, end);

  // Filter Q crossfade
  nodes.filter.Q.cancelScheduledValues(now);
  nodes.filter.Q.setValueAtTime(nodes.filter.Q.value, now);
  nodes.filter.Q.linearRampToValueAtTime(m.filterQ, end);

  // Filter LFO depth
  if (lfoNodes.filter) {
    lfoNodes.filter.depthGain.gain.setTargetAtTime(m.filterDepth, now, 1.0);
  }

  synthState.mood = newMood;
}

export function setDensity(val) {
  if (!ctx || !nodes.gainSend) return;

  const d = val / 100;
  const now = ctx.currentTime;
  const tc = 0.2;

  // Reverb wet/dry: 0 = fully dry, 100 = full reverb mix
  nodes.gainSend.gain.setTargetAtTime(d * 0.45, now, tc);
  nodes.gainWet.gain.setTargetAtTime(d > 0.01 ? 0.7 : 0.0001, now, tc);

  // Texture oscillators fade in/out with density
  const textureScale = 0.4 + d * 1.2;
  if (lfoNodes.amp[3]) {
    lfoNodes.amp[3].depthGain.gain.setTargetAtTime(AMP_DEPTHS[3] * textureScale, now, tc);
  }
  if (lfoNodes.amp[4]) {
    lfoNodes.amp[4].depthGain.gain.setTargetAtTime(AMP_DEPTHS[4] * textureScale, now, tc);
  }
  if (nodes.oscGains[3]) {
    nodes.oscGains[3].gain.setTargetAtTime(AMP_CENTERS[3] * textureScale, now, tc);
  }
  if (nodes.oscGains[4]) {
    nodes.oscGains[4].gain.setTargetAtTime(AMP_CENTERS[4] * textureScale, now, tc);
  }

  synthState.density = d;
}

export function setRate(val) {
  if (!ctx) return;

  // Map 0-100 → 0.25x-2.0x multiplier
  const mult = 0.25 + (val / 100) * 1.75;
  synthState.rateMultiplier = mult;

  if (!lfoNodes.amp) return;
  const now = ctx.currentTime;

  lfoNodes.amp.forEach((entry, i) => {
    entry.lfo.frequency.setTargetAtTime(mult / AMP_PERIODS[i], now, 0.3);
  });

  lfoNodes.freq.forEach((entry, i) => {
    entry.lfo.frequency.setTargetAtTime(mult / FREQ_PERIODS[i], now, 0.3);
  });

  if (lfoNodes.filter) {
    lfoNodes.filter.lfo.frequency.setTargetAtTime(mult / FILTER_PERIOD, now, 0.3);
  }
  if (lfoNodes.pan) {
    lfoNodes.pan.lfo.frequency.setTargetAtTime(mult / PAN_PERIOD, now, 0.3);
  }
}

// ─────────────────────────────────────────────────────────────
// Internal — graph construction
// ─────────────────────────────────────────────────────────────

function _buildGraph(moodKey) {
  const m = MOODS[moodKey];
  const now = ctx.currentTime;

  // 1. Oscillators
  nodes.oscs = OSC_TYPES.map((type, i) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = ROOT_HZ * m.ratios[i];
    if (m.detunes[i]) osc.detune.value = m.detunes[i];
    return osc;
  });

  // 2. Per-oscillator amplitude gain nodes
  nodes.oscGains = AMP_CENTERS.map((center) => {
    const g = ctx.createGain();
    g.gain.value = center;
    return g;
  });

  // 3. Connect oscillators → amplitude gains
  nodes.oscs.forEach((osc, i) => osc.connect(nodes.oscGains[i]));

  // 4. Lowpass filter
  nodes.filter = ctx.createBiquadFilter();
  nodes.filter.type = 'lowpass';
  nodes.filter.frequency.value = m.filterCenter;
  nodes.filter.Q.value = m.filterQ;

  // 5. All osc gains → filter
  nodes.oscGains.forEach((g) => g.connect(nodes.filter));

  // 6. Dry/wet split
  nodes.gainDry = ctx.createGain();
  nodes.gainSend = ctx.createGain();
  nodes.gainWet = ctx.createGain();
  nodes.gainDry.gain.value = 0.65;
  nodes.gainSend.gain.value = synthState.density * 0.45;
  nodes.gainWet.gain.value = synthState.density > 0.01 ? 0.7 : 0.0001;

  nodes.filter.connect(nodes.gainDry);
  nodes.filter.connect(nodes.gainSend);

  // 7. Convolver reverb — algorithmic IR, no audio file
  nodes.convolver = ctx.createConvolver();
  nodes.convolver.buffer = _buildImpulseResponse(4, 3);
  nodes.gainSend.connect(nodes.convolver);
  nodes.convolver.connect(nodes.gainWet);

  // 8. Master gain (start silent, fade in)
  nodes.gainMaster = ctx.createGain();
  nodes.gainMaster.gain.value = 0.0001;

  nodes.gainDry.connect(nodes.gainMaster);
  nodes.gainWet.connect(nodes.gainMaster);

  // 9. Stereo panner → destination
  nodes.panner = ctx.createStereoPanner();
  nodes.panner.pan.value = 0;
  nodes.gainMaster.connect(nodes.panner);
  nodes.panner.connect(ctx.destination);

  // 10. LFOs
  _buildLfos(m);

  // 11. Start all oscillators and LFOs
  const allOscs = [...nodes.oscs];
  const allLfos = [
    ...lfoNodes.amp.map((e) => e.lfo),
    ...lfoNodes.freq.map((e) => e.lfo),
    lfoNodes.filter.lfo,
    lfoNodes.pan.lfo,
  ];

  allOscs.forEach((osc) => osc.start(now));
  allLfos.forEach((lfo) => lfo.start(now));

  // 12. Fade in
  nodes.gainMaster.gain.setValueAtTime(0.0001, now);
  nodes.gainMaster.gain.exponentialRampToValueAtTime(MASTER_GAIN, now + FADE_IN_SEC);
}

function _buildLfos(m) {
  // Amplitude LFOs: modulate each oscillator's gain around its center
  lfoNodes.amp = AMP_PERIODS.map((period, i) => {
    const lfo = ctx.createOscillator();
    const depthGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = synthState.rateMultiplier / period;
    depthGain.gain.value = AMP_DEPTHS[i];
    lfo.connect(depthGain);
    depthGain.connect(nodes.oscGains[i].gain);
    return { lfo, depthGain };
  });

  // Frequency drift LFOs: subtle pitch wobble on drone oscillators only
  lfoNodes.freq = FREQ_PERIODS.map((period, i) => {
    const lfo = ctx.createOscillator();
    const depthGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = synthState.rateMultiplier / period;
    depthGain.gain.value = FREQ_DEPTHS[i];
    lfo.connect(depthGain);
    depthGain.connect(nodes.oscs[i].detune);
    return { lfo, depthGain };
  });

  // Filter cutoff LFO: slowly sweeps the lowpass cutoff within mood range
  {
    const lfo = ctx.createOscillator();
    const depthGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = synthState.rateMultiplier / FILTER_PERIOD;
    depthGain.gain.value = m.filterDepth;
    lfo.connect(depthGain);
    depthGain.connect(nodes.filter.frequency);
    lfoNodes.filter = { lfo, depthGain };
  }

  // Stereo pan LFO: triangle wave for linear drift across the stereo field
  {
    const lfo = ctx.createOscillator();
    const depthGain = ctx.createGain();
    lfo.type = 'triangle';
    lfo.frequency.value = synthState.rateMultiplier / PAN_PERIOD;
    depthGain.gain.value = 0.3;
    lfo.connect(depthGain);
    depthGain.connect(nodes.panner.pan);
    lfoNodes.pan = { lfo, depthGain };
  }
}

// ─────────────────────────────────────────────────────────────
// Internal — utilities
// ─────────────────────────────────────────────────────────────

function _buildImpulseResponse(durationSec, decay) {
  const len = ctx.sampleRate * durationSec;
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return ir;
}

function _teardown() {
  // Stop and disconnect all LFOs
  const allLfos = [
    ...(lfoNodes.amp || []).map((e) => e.lfo),
    ...(lfoNodes.freq || []).map((e) => e.lfo),
    lfoNodes.filter ? lfoNodes.filter.lfo : null,
    lfoNodes.pan ? lfoNodes.pan.lfo : null,
  ].filter(Boolean);

  allLfos.forEach((lfo) => {
    try {
      lfo.stop();
    } catch (_) {
      // already stopped
    }
    lfo.disconnect();
  });

  // Stop and disconnect oscillators
  (nodes.oscs || []).forEach((osc) => {
    try {
      osc.stop();
    } catch (_) {
      // already stopped
    }
    osc.disconnect();
  });

  // Disconnect remaining nodes
  [
    nodes.gainDry,
    nodes.gainSend,
    nodes.gainWet,
    nodes.gainMaster,
    nodes.filter,
    nodes.convolver,
    nodes.panner,
  ]
    .filter(Boolean)
    .forEach((n) => {
      try {
        n.disconnect();
      } catch (_) {
        // already disconnected
      }
    });

  nodes = {};
  lfoNodes = {};
}
