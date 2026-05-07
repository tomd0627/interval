# Interval — Claude Guidelines

## Tech stack

Vanilla HTML/CSS/JS. No framework, no build step, no audio library. ES modules (`type="module"`) served directly. Dev dependencies only (Husky, ESLint, Stylelint, Prettier).

## File layout

```
css/main.css      All styles — reset, tokens, components, animations
js/audio.js       Web Audio API synthesis engine — the core
js/visual.js      Orb animation driver — reads synthState, sets CSS custom properties
js/main.js        Entry point — event wiring, UI state transitions
```

## Audio rules

- Never set `.value` directly on a live `AudioParam`. Always use scheduling methods (`linearRampToValueAtTime`, `exponentialRampToValueAtTime`, `setTargetAtTime`).
- `exponentialRampToValueAtTime` requires strictly positive values — never ramp to or from zero. Use `0.0001` as the silent floor.
- No `AnalyserNode`, no FFT, no frequency visualization of any kind — that is Resonance's domain.
- No audio files, no `AudioBuffer` loaded from a URL. The reverb IR is generated at runtime in `_buildImpulseResponse`.
- All LFO periods must remain mutually prime — do not change them to round numbers.

## CSS rules

- CSS properties must be alphabetized (enforced by stylelint-order).
- Use logical properties over physical: `inline-size` not `width`, `block-size` not `height`, `padding-inline` not `padding-left/right`, etc.
- No unnecessary vendor prefixes — stylelint-config-standard enforces this.

## JS rules

- ESLint: `eqeqeq` always, `no-unused-vars`, `no-console` (allow `error`/`warn`).
- No `console.log` anywhere in production code.

## Linting

```bash
npm run lint:css
npm run lint:js
npm run format
```

Pre-commit hook runs Prettier → ESLint → Stylelint on staged files automatically.
