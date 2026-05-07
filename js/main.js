/**
 * INTERVAL — Entry Point
 * ======================
 *
 * Handles the user gesture requirement for AudioContext, wires all
 * controls to the audio engine, and manages UI state transitions.
 */

import { start, stop, mute, unmute, setMood, setDensity, setRate, synthState } from './audio.js';
import { init as initVisual, setActive, setMuted, updateRate } from './visual.js';

// ─────────────────────────────────────────────────────────────
// DOM references
// ─────────────────────────────────────────────────────────────

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const muteBtn = document.getElementById('muteBtn');
const prompt = document.getElementById('prompt');
const controls = document.getElementById('controls');
const orb = document.getElementById('orb');
const orbRing = document.getElementById('orbRing');
const densityInput = document.getElementById('density');
const rateInput = document.getElementById('rate');
const moodInputs = document.querySelectorAll('input[name="mood"]');

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────

initVisual(orb, orbRing);

// ─────────────────────────────────────────────────────────────
// Start / gesture gate
// ─────────────────────────────────────────────────────────────

startBtn.addEventListener('click', () => {
  const mood = _selectedMood();
  start(mood);

  // Sync initial parameter values into the engine
  setDensity(Number(densityInput.value));
  setRate(Number(rateInput.value));

  _onStarted();
});

// ─────────────────────────────────────────────────────────────
// Stop
// ─────────────────────────────────────────────────────────────

stopBtn.addEventListener('click', () => {
  stop();
  _onStopped();
});

// ─────────────────────────────────────────────────────────────
// Mute / unmute
// ─────────────────────────────────────────────────────────────

muteBtn.addEventListener('click', () => {
  if (synthState.isMuted) {
    unmute();
    muteBtn.setAttribute('aria-pressed', 'false');
    muteBtn.textContent = 'mute';
    setMuted(false);
  } else {
    mute();
    muteBtn.setAttribute('aria-pressed', 'true');
    muteBtn.textContent = 'unmute';
    setMuted(true);
  }
});

// Keyboard shortcut: M key toggles mute
document.addEventListener('keydown', (e) => {
  if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (synthState.isPlaying) muteBtn.click();
  }
});

// ─────────────────────────────────────────────────────────────
// Mood
// ─────────────────────────────────────────────────────────────

moodInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (synthState.isPlaying) setMood(input.value);
  });
});

// ─────────────────────────────────────────────────────────────
// Density
// ─────────────────────────────────────────────────────────────

densityInput.addEventListener('input', () => {
  const val = Number(densityInput.value);
  densityInput.setAttribute('aria-valuenow', val);
  if (synthState.isPlaying) setDensity(val);
});

// ─────────────────────────────────────────────────────────────
// Rate
// ─────────────────────────────────────────────────────────────

rateInput.addEventListener('input', () => {
  const val = Number(rateInput.value);
  rateInput.setAttribute('aria-valuenow', val);
  if (synthState.isPlaying) {
    setRate(val);
    updateRate();
  }
});

// ─────────────────────────────────────────────────────────────
// UI state transitions
// ─────────────────────────────────────────────────────────────

function _onStarted() {
  prompt.classList.add('is-hidden');
  controls.removeAttribute('aria-disabled');
  muteBtn.disabled = false;
  stopBtn.hidden = false;
  setActive(true);

  // After the prompt fade, fully remove from layout
  prompt.addEventListener(
    'transitionend',
    () => {
      prompt.hidden = true;
    },
    { once: true },
  );
}

function _onStopped() {
  setActive(false);
  stopBtn.hidden = true;
  muteBtn.disabled = true;
  muteBtn.setAttribute('aria-pressed', 'false');
  muteBtn.textContent = 'mute';
  controls.setAttribute('aria-disabled', 'true');

  // Re-show prompt after audio fades (matches FADE_OUT_SEC in audio.js)
  setTimeout(() => {
    prompt.hidden = false;
    // Allow layout reflow before re-animating opacity
    requestAnimationFrame(() => {
      prompt.classList.remove('is-hidden');
    });
  }, 2200);
}

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function _selectedMood() {
  for (const input of moodInputs) {
    if (input.checked) return input.value;
  }
  return 'still';
}
