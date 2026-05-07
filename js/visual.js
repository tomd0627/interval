/**
 * INTERVAL — Visual Driver
 * ========================
 *
 * Drives the orb element from synthesis parameters — not from audio output.
 *
 * Resonance reads audio output via AnalyserNode (FFT → visuals).
 * Interval reads synthesis input parameters (LFO config, rate multiplier,
 * mood) → CSS custom properties → visuals. The orb could produce identical
 * motion with the audio muted. This is the architectural distinction.
 */

import { synthState } from './audio.js';

const FILTER_PERIOD_BASE = 73; // mirrors audio.js FILTER_PERIOD
const BREATHE_BASE_SEC = 18;

let orbEl = null;
let ringEl = null;
let rafId = null;

export function init(orb, ring) {
  orbEl = orb;
  ringEl = ring;
}

export function setActive(active) {
  if (!orbEl || !ringEl) return;

  if (active) {
    _updateDurations();
    orbEl.classList.add('is-active');
    ringEl.classList.add('is-active');
    orbEl.classList.remove('is-muted');
    ringEl.classList.remove('is-muted');
    if (!rafId) rafId = requestAnimationFrame(_tick);
  } else {
    orbEl.classList.remove('is-active');
    ringEl.classList.remove('is-active');
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
}

export function setMuted(muted) {
  if (!orbEl || !ringEl) return;
  orbEl.classList.toggle('is-muted', muted);
  ringEl.classList.toggle('is-muted', muted);
}

// Called when Rate changes — updates CSS animation durations
export function updateRate() {
  if (synthState.isPlaying) _updateDurations();
}

// ─────────────────────────────────────────────────────────────
// Internal
// ─────────────────────────────────────────────────────────────

function _updateDurations() {
  const mult = synthState.rateMultiplier;
  const breatheSec = BREATHE_BASE_SEC / mult;
  const glowSec = FILTER_PERIOD_BASE / mult;

  document.documentElement.style.setProperty('--breathe-duration', `${breatheSec.toFixed(2)}s`);
  document.documentElement.style.setProperty('--glow-duration', `${glowSec.toFixed(2)}s`);
}

// rAF loop: currently a lightweight heartbeat.
// If future iterations need per-frame parameter reads, this is the hook.
function _tick() {
  rafId = requestAnimationFrame(_tick);
}
