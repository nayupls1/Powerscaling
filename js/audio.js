/* POWERSCALING — procedural audio (Web Audio API, no asset files)
 *
 * PS.Audio.init()                 idempotent, call on first user gesture
 * PS.Audio.play(name, {vol, pitch})
 * PS.Audio.setSfxVolume(v) / setMusicVolume(v)
 * PS.Audio.music('menu'|'run'|'boss'|'off')
 * PS.Audio.setIntensity(0..1)
 * PS.Audio.pause() / resume()     duck + muffle music (SFX keep working for menus)
 * Extras: PS.Audio.names (sfx list), PS.Audio.isReady()
 *
 * Every function is a silent no-op when Web Audio is unavailable or not yet initialised.
 */
(function () {
  'use strict';
  const PS = (window.PS = window.PS || {});

  // ---------------------------------------------------------------------------
  // Core state
  // ---------------------------------------------------------------------------
  let ctx = null, comp = null, master = null, sfxBus = null, musicGain = null, duckGain = null, duckLP = null;
  let noiseBuf = null;
  let sfxVol = 0.8, musicVol = 0.35, paused = false, initFailed = false;
  const MUSIC_SCALE = 0.55;              // keeps music clearly under SFX
  const MAX_VOICES = 24;
  const voices = [];                     // end times (ctx time) of active sfx voices
  const lastPlay = Object.create(null);  // name -> Date.now() of last play
  const S = { v: 1, p: 1 };              // per-play volume/pitch scale applied to sfx nodes

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const hz = (base, semi) => base * Math.pow(2, semi / 12);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const safeDisconnect = (...nodes) => { for (const n of nodes) { if (n) { try { n.disconnect(); } catch (e) { /* ignore */ } } } };
  const nyq = () => (ctx ? ctx.sampleRate * 0.45 : 18000);

  function setTarget(param, value, t, tc) {
    try { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); param.setTargetAtTime(value, t, tc); } catch (e) { /* ignore */ }
  }

  /** attack / optional hold / exponential release envelope */
  function env(param, t, a, hold, d, vol) {
    vol = Math.max(vol, 0.0002);
    a = Math.max(a, 0.001);
    if (d < a + hold + 0.005) d = a + hold + 0.005;
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(vol, t + a);
    if (hold > 0) param.setValueAtTime(vol, t + a + hold);
    param.exponentialRampToValueAtTime(0.0001, t + d);
    return d;
  }

  function makeFilter(o, t, scale) {
    if (!o.ft) return null;
    const f = ctx.createBiquadFilter();
    f.type = o.ft;
    f.frequency.setValueAtTime(clamp(o.ff * scale, 20, nyq()), t);
    if (o.ff1) f.frequency.exponentialRampToValueAtTime(clamp(o.ff1 * scale, 20, nyq()), t + (o.fslide || o.dur));
    f.Q.value = num(o.q, 0.7);
    return f;
  }

  /** Tone voice. o: {t, type, f, f1, slide, dur, vol, a, hold, det, ft, ff, ff1, fslide, q, out} */
  function T(o) {
    const isSfx = !o.out;
    const p = isSfx ? S.p : 1, vs = isSfx ? S.v : 1;
    const t = o.t, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(clamp(o.f * p, 10, nyq()), t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(clamp(o.f1 * p, 10, nyq()), t + (o.slide || o.dur));
    if (o.det) osc.detune.value = o.det;
    const d = env(g.gain, t, num(o.a, 0.004), o.hold || 0, o.dur, o.vol * vs);
    const f = makeFilter(o, t, p);
    if (f) { osc.connect(f); f.connect(g); } else osc.connect(g);
    g.connect(o.out || sfxBus);
    osc.onended = () => safeDisconnect(osc, f, g);
    osc.start(t);
    osc.stop(t + d + 0.03);
  }

  /** Filtered noise voice (shares one pre-generated buffer). o: {t, dur, vol, a, hold, ft, ff, ff1, fslide, q, out} */
  function N(o) {
    const isSfx = !o.out;
    const vs = isSfx ? S.v : 1;
    const t = o.t, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = noiseBuf;
    src.loop = true;
    const d = env(g.gain, t, num(o.a, 0.002), o.hold || 0, o.dur, o.vol * vs);
    const f = makeFilter(Object.assign({ ft: 'lowpass', ff: 8000 }, o), t, isSfx ? Math.sqrt(S.p) : 1);
    src.connect(f); f.connect(g);
    g.connect(o.out || sfxBus);
    src.onended = () => safeDisconnect(src, f, g);
    src.start(t, Math.random() * 1.5);
    src.stop(t + d + 0.03);
  }

  /** Play a sequence of semitone offsets from base, step seconds apart. */
  function seq(t, base, semis, step, o) {
    for (let i = 0; i < semis.length; i++) T(Object.assign({}, o, { t: t + i * step, f: hz(base, semis[i]) }));
  }

  /** Bell: fundamental plus inharmonic partials. */
  function bell(t, f, dur, vol, out) {
    T({ t, f, dur, vol, a: 0.003, out });
    T({ t, f: f * 2.76, dur: dur * 0.45, vol: vol * 0.35, a: 0.002, out });
    T({ t, f: f * 5.4, dur: dur * 0.2, vol: vol * 0.15, a: 0.002, out });
  }

  // ---------------------------------------------------------------------------
  // SFX recipes. Each: fn(t) -> approximate duration. rate = min ms between plays,
  // jit = random pitch spread, max = per-name concurrent cap (optional).
  // ---------------------------------------------------------------------------
  const SFX = {
    // ---- combat
    hit: { rate: 40, jit: 0.08, fn(t) {
      N({ t, dur: 0.04, vol: 0.18, ft: 'bandpass', ff: 2600, ff1: 1200, q: 1.2 });
      T({ t, type: 'triangle', f: 620, f1: 280, dur: 0.05, vol: 0.14 });
      return 0.06; } },
    crit: { rate: 45, jit: 0.06, fn(t) {
      T({ t, type: 'square', f: 1500, f1: 700, dur: 0.06, vol: 0.07, ft: 'lowpass', ff: 4500 });
      T({ t, f: 2300, dur: 0.09, vol: 0.09 });
      N({ t, dur: 0.05, vol: 0.14, ft: 'highpass', ff: 5000 });
      T({ t, type: 'triangle', f: 300, f1: 120, dur: 0.07, vol: 0.18 });
      return 0.1; } },
    kill: { rate: 50, jit: 0.1, fn(t) {
      T({ t, f: 420, f1: 90, dur: 0.12, vol: 0.28 });
      N({ t, dur: 0.1, vol: 0.16, ft: 'lowpass', ff: 1400, ff1: 300 });
      return 0.13; } },
    eliteDie: { rate: 80, jit: 0.05, fn(t) {
      N({ t, dur: 0.38, vol: 0.45, ft: 'lowpass', ff: 2800, ff1: 180 });
      T({ t, type: 'square', f: 170, f1: 40, dur: 0.32, vol: 0.12, ft: 'lowpass', ff: 900 });
      T({ t, f: 95, f1: 35, dur: 0.42, vol: 0.45 });
      T({ t: t + 0.05, f: 640, f1: 160, dur: 0.15, vol: 0.08 });
      return 0.45; } },
    hurt: { rate: 120, jit: 0.04, fn(t) {
      T({ t, f: 150, f1: 55, dur: 0.24, vol: 0.55 });
      T({ t, type: 'square', f: 466, dur: 0.14, vol: 0.05, ft: 'lowpass', ff: 2000 });
      T({ t, type: 'square', f: 494, dur: 0.14, vol: 0.05, ft: 'lowpass', ff: 2000 });
      N({ t, dur: 0.08, vol: 0.15, ft: 'lowpass', ff: 1200 });
      return 0.25; } },
    death: { rate: 500, jit: 0, fn(t) {
      T({ t, type: 'sawtooth', f: 440, f1: 55, dur: 1.5, vol: 0.14, ft: 'lowpass', ff: 2000, ff1: 250 });
      T({ t, type: 'sawtooth', f: 447, f1: 56, dur: 1.5, vol: 0.12, ft: 'lowpass', ff: 2000, ff1: 250 });
      T({ t, f: 120, f1: 28, dur: 1.7, vol: 0.4 });
      N({ t, dur: 1.2, vol: 0.18, ft: 'lowpass', ff: 900, ff1: 90 });
      bell(t + 0.9, 220, 1.6, 0.06);
      return 1.8; } },
    revive: { rate: 500, jit: 0, fn(t) {
      seq(t, 440, [0, 4, 7, 12, 16, 19, 24], 0.06, { type: 'triangle', dur: 0.35, vol: 0.1 });
      N({ t, dur: 0.7, a: 0.45, vol: 0.1, ft: 'highpass', ff: 3000, ff1: 9000 });
      T({ t, f: 220, f1: 880, dur: 0.6, a: 0.3, vol: 0.08 });
      return 0.8; } },

    // ---- player actions
    slash: { rate: 50, jit: 0.1, fn(t) {
      N({ t, dur: 0.16, a: 0.03, vol: 0.32, ft: 'bandpass', ff: 600, ff1: 3200, q: 1.3 });
      T({ t, f: 320, f1: 150, dur: 0.08, vol: 0.05 });
      return 0.17; } },
    shoot: { rate: 45, jit: 0.07, fn(t) {
      T({ t, f: 950, f1: 480, dur: 0.1, vol: 0.14 });
      T({ t, type: 'triangle', f: 1900, f1: 900, dur: 0.07, vol: 0.04 });
      return 0.1; } },
    arrow: { rate: 45, jit: 0.07, fn(t) {
      T({ t, type: 'triangle', f: 720, f1: 180, slide: 0.06, dur: 0.1, vol: 0.2 });
      N({ t, dur: 0.06, vol: 0.09, ft: 'highpass', ff: 3200 });
      return 0.1; } },
    scythe: { rate: 60, jit: 0.08, fn(t) {
      N({ t, dur: 0.28, a: 0.07, vol: 0.32, ft: 'bandpass', ff: 1400, ff1: 250, q: 2 });
      T({ t, type: 'sawtooth', f: 110, f1: 65, dur: 0.26, a: 0.05, vol: 0.06, ft: 'lowpass', ff: 600 });
      return 0.3; } },
    dash: { rate: 80, jit: 0.06, fn(t) {
      N({ t, dur: 0.22, a: 0.05, vol: 0.3, ft: 'bandpass', ff: 800, ff1: 2600, q: 0.8 });
      return 0.23; } },
    ability: { rate: 120, jit: 0.03, fn(t) {
      T({ t, type: 'sawtooth', f: 110, f1: 660, slide: 0.12, dur: 0.16, vol: 0.08, ft: 'lowpass', ff: 600, ff1: 4000 });
      const b = t + 0.12;
      N({ t: b, dur: 0.55, vol: 0.4, ft: 'lowpass', ff: 3500, ff1: 200 });
      T({ t: b, f: 220, f1: 50, dur: 0.5, vol: 0.5 });
      seq(b, 660, [0, 7, 12], 0.03, { type: 'triangle', dur: 0.3, vol: 0.06 });
      return 0.7; } },

    // ---- elements
    fire: { rate: 60, jit: 0.1, fn(t) {
      N({ t, dur: 0.32, a: 0.04, vol: 0.38, ft: 'lowpass', ff: 250, ff1: 1600, fslide: 0.08, q: 1.5 });
      T({ t, f: 130, f1: 60, dur: 0.25, vol: 0.22 });
      return 0.33; } },
    explode: { rate: 70, jit: 0.1, fn(t) {
      N({ t, dur: 0.45, vol: 0.5, ft: 'lowpass', ff: 3200, ff1: 150 });
      T({ t, f: 130, f1: 40, dur: 0.4, vol: 0.45 });
      return 0.46; } },
    bigExplode: { rate: 150, jit: 0.05, fn(t) {
      N({ t, dur: 0.08, vol: 0.35, ft: 'highpass', ff: 2200 });
      N({ t, dur: 1.0, vol: 0.6, ft: 'lowpass', ff: 4000, ff1: 100 });
      T({ t, f: 85, f1: 28, dur: 1.0, vol: 0.75 });
      T({ t, type: 'square', f: 62, f1: 30, dur: 0.6, vol: 0.08, ft: 'lowpass', ff: 300 });
      return 1.0; } },
    frost: { rate: 50, jit: 0.05, fn(t) {
      T({ t, f: 1760, dur: 0.5, vol: 0.09 });
      T({ t, f: 2640, dur: 0.35, vol: 0.05 });
      T({ t, f: 3530, dur: 0.25, vol: 0.035 });
      N({ t, dur: 0.1, vol: 0.05, ft: 'highpass', ff: 6000 });
      return 0.5; } },
    freeze: { rate: 90, jit: 0.04, fn(t) {
      for (let i = 0; i < 6; i++) N({ t: t + rnd(0, 0.18), dur: 0.015, a: 0.001, vol: rnd(0.12, 0.25), ft: 'highpass', ff: rnd(3000, 7000) });
      bell(t + 0.08, 1568, 0.7, 0.08);
      T({ t: t + 0.08, f: 2349, dur: 0.5, vol: 0.04 });
      return 0.8; } },
    zap: { rate: 40, jit: 0.12, fn(t) {
      T({ t, type: 'sawtooth', f: 2000, f1: 400, dur: 0.08, vol: 0.06, ft: 'bandpass', ff: 2500, q: 1 });
      N({ t, dur: 0.07, vol: 0.2, ft: 'bandpass', ff: 3200, q: 3 });
      T({ t, type: 'square', f: 95, dur: 0.06, vol: 0.04, ft: 'lowpass', ff: 1500 });
      return 0.09; } },
    thunder: { rate: 150, jit: 0.06, fn(t) {
      N({ t, dur: 0.12, vol: 0.45, ft: 'highpass', ff: 1500 });
      N({ t: t + 0.03, dur: 1.4, a: 0.05, vol: 0.45, ft: 'lowpass', ff: 700, ff1: 80 });
      T({ t, f: 65, f1: 30, dur: 1.2, vol: 0.35 });
      return 1.45; } },
    poison: { rate: 60, jit: 0.1, fn(t) {
      for (let i = 0; i < 4; i++) {
        const f = rnd(260, 420);
        T({ t: t + i * 0.045 + rnd(0, 0.015), f, f1: f * 2.2, dur: 0.06, vol: 0.09 });
      }
      N({ t, dur: 0.2, vol: 0.07, ft: 'lowpass', ff: 600 });
      return 0.25; } },
    void: { rate: 80, jit: 0.05, fn(t) {
      T({ t, type: 'sawtooth', f: 55, dur: 0.48, a: 0.36, vol: 0.1, ft: 'lowpass', ff: 200, ff1: 1500, fslide: 0.38 });
      T({ t, type: 'sawtooth', f: 58.3, dur: 0.48, a: 0.36, vol: 0.1, ft: 'lowpass', ff: 200, ff1: 1500, fslide: 0.38 });
      T({ t, f: 880, f1: 220, dur: 0.45, a: 0.3, vol: 0.04 });
      N({ t, dur: 0.44, a: 0.34, vol: 0.16, ft: 'bandpass', ff: 300, ff1: 900, q: 1.5 });
      return 0.5; } },
    summon: { rate: 120, jit: 0.04, fn(t) {
      T({ t, f: 220, f1: 660, dur: 0.65, a: 0.22, vol: 0.09 });
      T({ t, type: 'triangle', f: 330, f1: 990, dur: 0.65, a: 0.26, vol: 0.05, det: 9 });
      N({ t, dur: 0.55, a: 0.22, vol: 0.06, ft: 'bandpass', ff: 1200, ff1: 3200, q: 4 });
      return 0.66; } },
    laser: { rate: 200, jit: 0.03, fn(t) {
      T({ t, type: 'sawtooth', f: 880, f1: 820, dur: 0.55, a: 0.02, hold: 0.38, vol: 0.05, ft: 'lowpass', ff: 3200 });
      T({ t, type: 'square', f: 443, dur: 0.55, a: 0.02, hold: 0.38, vol: 0.025, ft: 'lowpass', ff: 2000 });
      T({ t, f: 1760, f1: 1500, dur: 0.55, a: 0.01, hold: 0.35, vol: 0.04 });
      N({ t, dur: 0.55, a: 0.02, hold: 0.38, vol: 0.05, ft: 'bandpass', ff: 5000, q: 2 });
      return 0.56; } },

    // ---- pickups / progression
    gem: { rate: 30, jit: 0.015, max: 6, fn(t) {
      T({ t, f: 1320, f1: 1980, slide: 0.04, dur: 0.07, vol: 0.12 });
      T({ t, type: 'triangle', f: 2640, dur: 0.05, vol: 0.03 });
      return 0.07; } },
    gold: { rate: 40, jit: 0.03, fn(t) {
      T({ t, f: 2093, dur: 0.1, vol: 0.09 });
      T({ t: t + 0.05, f: 2637, dur: 0.2, vol: 0.09 });
      T({ t: t + 0.05, f: 5274, dur: 0.08, vol: 0.02 });
      return 0.26; } },
    heal: { rate: 120, jit: 0.02, fn(t) {
      seq(t, 523.25, [0, 4, 7, 12], 0.06, { type: 'sine', dur: 0.3, vol: 0.1 });
      T({ t, type: 'triangle', f: 261.6, dur: 0.45, a: 0.08, vol: 0.05 });
      return 0.5; } },
    magnet: { rate: 200, jit: 0.03, fn(t) {
      N({ t, dur: 0.55, a: 0.12, vol: 0.25, ft: 'bandpass', ff: 3200, ff1: 400, q: 3 });
      T({ t, f: 1200, f1: 300, dur: 0.5, a: 0.1, vol: 0.05 });
      return 0.56; } },
    bomb: { rate: 150, jit: 0.05, fn(t) {
      N({ t, dur: 0.06, vol: 0.3, ft: 'highpass', ff: 2500 });
      N({ t, dur: 0.75, vol: 0.6, ft: 'lowpass', ff: 3500, ff1: 120 });
      T({ t, f: 105, f1: 30, dur: 0.75, vol: 0.7 });
      return 0.76; } },
    chest: { rate: 200, jit: 0.02, fn(t) {
      T({ t, type: 'sawtooth', f: 170, f1: 110, dur: 0.28, vol: 0.06, ft: 'bandpass', ff: 900, q: 8 });
      T({ t: t + 0.1, type: 'sawtooth', f: 140, f1: 120, dur: 0.15, vol: 0.04, ft: 'bandpass', ff: 700, q: 8 });
      seq(t + 0.22, 1046.5, [0, 4, 7, 12, 16, 19, 24], 0.04, { dur: 0.25, vol: 0.06 });
      N({ t: t + 0.22, dur: 0.4, vol: 0.05, ft: 'highpass', ff: 7000 });
      return 0.75; } },
    relic: { rate: 200, jit: 0, fn(t) {
      const o = { type: 'square', vol: 0.045, ft: 'lowpass', ff: 3000 };
      seq(t, 523.25, [0, 4, 7], 0.09, Object.assign({ dur: 0.14 }, o));
      T(Object.assign({ t: t + 0.27, f: 1046.5, dur: 0.55, hold: 0.15 }, o));
      T({ t: t + 0.27, type: 'triangle', f: 659.3, dur: 0.55, hold: 0.15, vol: 0.06 });
      T({ t: t + 0.27, type: 'triangle', f: 784, dur: 0.55, hold: 0.15, vol: 0.05 });
      return 0.85; } },
    levelup: { rate: 200, jit: 0, fn(t) {
      const notes = [0, 4, 7, 12, 16, 19, 24];
      seq(t, 523.25, notes, 0.055, { type: 'square', dur: 0.22, vol: 0.045, ft: 'lowpass', ff: 3800 });
      seq(t, 523.25, notes, 0.055, { type: 'triangle', dur: 0.25, vol: 0.07 });
      const c = t + notes.length * 0.055;
      for (const s of [12, 16, 19, 24]) T({ t: c, type: 'triangle', f: hz(523.25, s), dur: 0.7, hold: 0.1, vol: 0.05 });
      T({ t: c, f: 130.8, f1: 65.4, dur: 0.4, vol: 0.25 });
      N({ t: c, dur: 0.6, vol: 0.07, ft: 'highpass', ff: 8000 });
      return 1.1; } },
    pick: { rate: 120, jit: 0, fn(t) {
      N({ t, dur: 0.02, vol: 0.1, ft: 'highpass', ff: 3000 });
      seq(t, 659.3, [0, 4, 7, 12], 0.015, { type: 'triangle', dur: 0.32, vol: 0.07 });
      return 0.38; } },
    evolve: { rate: 300, jit: 0, fn(t) {
      N({ t, dur: 0.5, a: 0.45, vol: 0.18, ft: 'bandpass', ff: 400, ff1: 6000, q: 1.5 });
      T({ t, type: 'sawtooth', f: 110, f1: 880, dur: 0.5, a: 0.45, vol: 0.05, ft: 'lowpass', ff: 500, ff1: 5000 });
      const a = t + 0.45;
      seq(a, 392, [0, 4, 7, 12, 16, 19, 24, 28, 31], 0.05, { type: 'triangle', dur: 0.3, vol: 0.06 });
      const c = a + 0.5;
      T({ t: c, f: 98, f1: 49, dur: 0.6, vol: 0.45 });
      for (const s of [0, 7, 12, 16, 19, 24]) {
        T({ t: c, type: 'sawtooth', f: hz(392, s - 12), dur: 1.3, a: 0.02, hold: 0.25, vol: 0.03, ft: 'lowpass', ff: 2800, ff1: 900 });
        T({ t: c, type: 'triangle', f: hz(392, s), dur: 1.2, hold: 0.2, vol: 0.035, det: 6 });
      }
      N({ t: c, dur: 1.0, vol: 0.08, ft: 'highpass', ff: 7500 });
      return 2.3; } },
    ascend: { rate: 300, jit: 0, fn(t) {
      // choir-ish: detuned saw stack through two formant bandpasses ("ah")
      for (const s of [0, 7, 12, 16, 19]) {
        for (const det of [-8, 8]) {
          for (const [ff, v] of [[750, 0.05], [1200, 0.03]]) {
            T({ t, type: 'sawtooth', f: hz(220, s), det, dur: 1.8, a: 0.55, hold: 0.4, vol: v, ft: 'bandpass', ff, q: 5 });
          }
        }
      }
      T({ t, f: 55, dur: 1.6, a: 0.5, vol: 0.25 });
      T({ t: t + 0.55, f: 110, f1: 45, dur: 0.6, vol: 0.4 });
      N({ t: t + 0.4, dur: 1.2, a: 0.2, vol: 0.06, ft: 'highpass', ff: 7000 });
      bell(t + 0.55, 1760, 1.2, 0.05);
      return 1.9; } },
    shrine: { rate: 300, jit: 0, fn(t) {
      [0, 7, 14].forEach((s, i) => bell(t + i * 0.13, hz(880, s), 1.3, 0.06));
      T({ t, f: 220, dur: 1.4, a: 0.3, vol: 0.06 });
      return 1.6; } },

    // ---- boss
    bossWarn: { rate: 800, jit: 0, fn(t) {
      for (const st of [0, 0.62]) {
        for (const [f, v] of [[110, 0.1], [155.6, 0.07], [111.3, 0.08]]) {
          T({ t: t + st, type: 'sawtooth', f, f1: f * 0.97, dur: 0.58, a: 0.12, hold: 0.25, vol: v, ft: 'lowpass', ff: 350, ff1: 1400, fslide: 0.2, q: 2 });
        }
        T({ t: t + st, f: 55, dur: 0.58, a: 0.1, hold: 0.25, vol: 0.3 });
      }
      return 1.25; } },
    bossDie: { rate: 1000, jit: 0, fn(t) {
      SFX.bigExplode.fn(t);
      SFX.explode.fn(t + 0.3);
      SFX.explode.fn(t + 0.65);
      const c = t + 1.0;
      seq(c, 392, [0, 4, 7, 12], 0.1, { type: 'square', dur: 0.2, vol: 0.04, ft: 'lowpass', ff: 3000 });
      for (const s of [0, 4, 7, 12, 16]) T({ t: c + 0.4, type: 'triangle', f: hz(392, s), dur: 1.6, hold: 0.4, vol: 0.05, det: 5 });
      T({ t: c + 0.4, type: 'sawtooth', f: 98, dur: 1.6, hold: 0.3, vol: 0.05, ft: 'lowpass', ff: 900 });
      N({ t: c + 0.4, dur: 1.2, vol: 0.06, ft: 'highpass', ff: 8000 });
      return 3.0; } },
    telegraph: { rate: 80, jit: 0.02, fn(t) {
      T({ t, type: 'square', f: 1040, dur: 0.045, vol: 0.05, ft: 'lowpass', ff: 3000 });
      T({ t: t + 0.07, type: 'square', f: 1040, dur: 0.045, vol: 0.04, ft: 'lowpass', ff: 3000 });
      return 0.12; } },

    // ---- UI
    uiHover: { rate: 35, jit: 0.02, fn(t) {
      T({ t, f: 1800, dur: 0.025, vol: 0.03 });
      return 0.03; } },
    uiClick: { rate: 40, jit: 0.02, fn(t) {
      T({ t, type: 'triangle', f: 900, f1: 600, dur: 0.05, vol: 0.1 });
      N({ t, dur: 0.02, vol: 0.04, ft: 'highpass', ff: 4000 });
      return 0.06; } },
    uiBack: { rate: 40, jit: 0.02, fn(t) {
      T({ t, type: 'triangle', f: 620, f1: 340, dur: 0.08, vol: 0.1 });
      return 0.09; } },
    buy: { rate: 80, jit: 0, fn(t) {
      N({ t, dur: 0.03, vol: 0.15, ft: 'highpass', ff: 3500 });
      T({ t, f: 210, f1: 80, dur: 0.1, vol: 0.28 });
      T({ t, type: 'square', f: 1046.5, dur: 0.07, vol: 0.05, ft: 'lowpass', ff: 4000 });
      T({ t: t + 0.06, f: 1568, dur: 0.35, vol: 0.09 });
      T({ t: t + 0.06, f: 2093, dur: 0.4, vol: 0.08 });
      T({ t: t + 0.06, f: 4186, dur: 0.12, vol: 0.02 });
      return 0.47; } },
    deny: { rate: 120, jit: 0, fn(t) {
      for (const st of [0, 0.1]) {
        T({ t: t + st, type: 'square', f: 150, dur: 0.08, vol: 0.05, ft: 'lowpass', ff: 900 });
        T({ t: t + st, type: 'square', f: 156, dur: 0.08, vol: 0.05, ft: 'lowpass', ff: 900 });
      }
      return 0.2; } },
  };

  // ---------------------------------------------------------------------------
  // Music: lookahead step sequencer (16ths), one gain bus per mode for crossfades
  // ---------------------------------------------------------------------------
  const CH = { // chords as semitones relative to A
    Am: [0, 3, 7], F: [-4, 0, 3], C: [3, 7, 10], G: [-2, 2, 5], Dm: [-7, -4, 0], E: [-5, -1, 2],
    Fmaj7: [-4, 0, 3, 7], Dm7: [-7, -4, 0, 3], Em: [-5, -2, 2], Bb: [-11, -7, -4], Gm: [-2, 1, 5], Eb: [-6, -2, 1],
  };
  const SONGS = {
    menu: { bpm: 68, prog: ['Am', 'Am', 'Fmaj7', 'Fmaj7', 'Dm7', 'Dm7', 'Em', 'Em'] },
    run: { bpm: 122, prog: ['Am', 'F', 'C', 'G', 'Am', 'F', 'Dm', 'E'] },
    boss: { bpm: 142, prog: ['Am', 'Bb', 'Am', 'Gm', 'Am', 'Bb', 'Eb', 'E'] },
  };
  const M = { mode: 'off', pending: null, bus: null, timer: null, next: 0, step: 0, intensity: 0, stopTimeout: null };

  const bassFreq = (root) => { let r = ((root % 12) + 12) % 12; if (r > 7) r -= 12; return hz(55, r); };

  function mKick(t, v, out) {
    T({ t, f: 155, f1: 42, slide: 0.11, dur: 0.32, vol: 0.62 * v, a: 0.002, out });
    T({ t, type: 'triangle', f: 900, f1: 150, dur: 0.02, vol: 0.08 * v, a: 0.001, out });
  }
  const mHat = (t, v, out) => N({ t, dur: 0.045, vol: 0.06 * v, ft: 'highpass', ff: 7500, out });
  function mSnare(t, v, out) {
    N({ t, dur: 0.16, vol: 0.16 * v, ft: 'bandpass', ff: 1800, q: 0.7, out });
    T({ t, type: 'triangle', f: 200, f1: 140, dur: 0.08, vol: 0.12 * v, out });
  }
  const mBass = (t, f, dur, v, out) => T({ t, type: 'sawtooth', f, dur, vol: 0.16 * v, a: 0.005, ft: 'lowpass', ff: 1100, ff1: 180, fslide: dur, q: 3, out });
  const mArp = (t, f, v, out) => T({ t, type: 'square', f, dur: 0.13, vol: 0.028 * v, ft: 'lowpass', ff: 2400, out });
  const mLead = (t, f, dur, v, out) => {
    T({ t, type: 'triangle', f, dur, vol: 0.05 * v, a: 0.01, out });
    T({ t, type: 'sawtooth', f, det: 7, dur, vol: 0.018 * v, a: 0.01, ft: 'lowpass', ff: 2200, out });
  };
  function mPad(t, chord, dur, v, a, out, cutoff) {
    for (const s of chord) {
      for (const det of [-7, 7]) T({ t, type: 'sawtooth', f: hz(220, s), det, dur, a, hold: dur * 0.4, vol: 0.022 * v, ft: 'lowpass', ff: cutoff || 900, q: 0.8, out });
    }
  }

  function scheduleStep(mode, step, t, sd) {
    const out = M.bus, song = SONGS[mode];
    const s = step % 16, bar = Math.floor(step / 16);
    const chord = CH[song.prog[bar % song.prog.length]];
    const I = M.intensity;

    if (mode === 'menu') {
      if (s === 0 && bar % 2 === 0) {
        mPad(t, chord, sd * 32, 1.1, 1.6, out, 700);
        T({ t, f: bassFreq(chord[0]), dur: sd * 32, a: 1.2, hold: sd * 16, vol: 0.12, out });
      }
      if (s % 4 === 0 && Math.random() < 0.16) {
        const penta = [0, 3, 5, 7, 10, 12, 15];
        bell(t, hz(880, penta[(Math.random() * penta.length) | 0]), 2.4, 0.035, out);
      }
      return;
    }

    if (mode === 'run') {
      if (s % 4 === 0) mKick(t, 0.65 + 0.35 * I, out);
      if (I > 0.85 && s === 14) mKick(t, 0.6, out);
      if (I >= 0.3 && (s === 4 || s === 12)) mSnare(t, 0.7 + 0.3 * I, out);
      if (I >= 0.2 && s % 4 === 2) mHat(t, 1, out);
      if (I >= 0.55 && s % 2 === 1) mHat(t, 0.5, out);
      if (s % 2 === 0) {
        const pat = [0, 0, 12, 0, 0, 12, 7, 12];
        const f = bassFreq(chord[0]) * Math.pow(2, pat[s / 2] / 12);
        mBass(t, f, sd * 1.8, 1, out);
        if (I >= 0.7) mBass(t, f * 2, sd * 1.5, 0.45, out);
      }
      if (s === 0) mPad(t, chord, sd * 16, 0.9 - 0.3 * I, 0.25, out, 800 + 600 * I);
      if (I >= 0.4) {
        const order = [0, 1, 2, 3, 4, 3, 2, 1];
        const k = order[s % 8], tone = chord[k % 3] + 12 * Math.floor(k / 3);
        mArp(t, hz(440, tone), 0.7 + 0.5 * (I - 0.4), out);
      }
      if (I >= 0.7) {
        const mel = { 0: [2, 2], 6: [1, 1], 10: [0, 2], 12: [1, 3] };
        const m = mel[s];
        if (m) mLead(t, hz(880, chord[m[0]]), sd * m[1], 0.8 + 0.4 * (I - 0.7), out);
      }
      return;
    }

    if (mode === 'boss') {
      if ([0, 3, 6, 8, 10, 11, 14].indexOf(s) >= 0) mKick(t, s % 4 === 0 ? 1 : 0.7, out);
      if (s === 4 || s === 12) mSnare(t, 1, out);
      mHat(t, s % 2 ? 0.5 : 0.9, out);
      const f = bassFreq(chord[0]);
      mBass(t, s % 8 === 7 ? f * 2 : f, sd * 0.9, 1.05, out);
      if (s === 0) mPad(t, chord, sd * 16, 0.8, 0.08, out, 1300);
      if (I >= 0.3 || s % 2 === 0) {
        const tone = chord[s % 3] + (s & 4 ? 12 : 0);
        mArp(t, hz(440, tone), 0.8, out);
      }
      if (s === 0 && bar % 2 === 1) mLead(t, hz(880, chord[0] + 6), sd * 3, 0.7, out); // tritone stab
    }
  }

  function stepDur() {
    const song = SONGS[M.mode];
    let bpm = song.bpm;
    if (M.mode === 'run') bpm += 10 * M.intensity;
    else if (M.mode === 'boss') bpm += 6 * M.intensity;
    return 60 / bpm / 4;
  }

  function tick() {
    try {
      if (!ctx || !M.bus || !SONGS[M.mode] || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (M.next < now - 0.1) M.next = now + 0.03; // recover after stalls
      while (M.next < now + 0.15) {
        const sd = stepDur();
        scheduleStep(M.mode, M.step, M.next, sd);
        M.next += sd;
        M.step++;
      }
    } catch (e) { /* never let the scheduler throw */ }
  }

  function startMusic(mode) {
    const now = ctx.currentTime;
    const fade = mode === 'boss' || M.mode === 'boss' ? 0.6 : 1.2;
    if (M.bus) {
      const old = M.bus;
      setTarget(old.gain, 0.0001, now, fade / 4);
      setTimeout(() => safeDisconnect(old), (fade + 2.5) * 1000);
    }
    M.mode = mode;
    M.bus = null;
    if (M.stopTimeout) { clearTimeout(M.stopTimeout); M.stopTimeout = null; }
    if (mode === 'off') {
      M.stopTimeout = setTimeout(() => { if (M.mode === 'off' && M.timer) { clearInterval(M.timer); M.timer = null; } }, (fade + 0.5) * 1000);
      return;
    }
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.linearRampToValueAtTime(1, now + fade);
    bus.connect(musicGain);
    M.bus = bus;
    M.step = 0;
    M.next = now + 0.06;
    if (!M.timer) M.timer = setInterval(tick, 50);
    tick();
  }

  // ---------------------------------------------------------------------------
  // Init / public API
  // ---------------------------------------------------------------------------
  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { initFailed = true; return; }
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 6;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 0.9;
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxVol;
    musicGain = ctx.createGain(); musicGain.gain.value = musicVol * MUSIC_SCALE;
    duckGain = ctx.createGain(); duckGain.gain.value = 1;
    duckLP = ctx.createBiquadFilter(); duckLP.type = 'lowpass'; duckLP.frequency.value = 20000; duckLP.Q.value = 0.5;
    musicGain.connect(duckGain); duckGain.connect(duckLP); duckLP.connect(comp);
    sfxBus.connect(comp);
    comp.connect(master); master.connect(ctx.destination);

    const len = Math.floor(ctx.sampleRate * 2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        try {
          if (!ctx) return;
          if (document.hidden) ctx.suspend();
          else ctx.resume();
        } catch (e) { /* ignore */ }
      });
    }
  }

  function ready() { return !!ctx && ctx.state !== 'closed'; }

  const Audio = {
    names: Object.keys(SFX),

    isReady() { return ready() && ctx.state === 'running'; },

    init() {
      try {
        if (!ctx && !initFailed) build();
        if (!ctx) return;
        if (ctx.state === 'suspended' && !(typeof document !== 'undefined' && document.hidden)) {
          const p = ctx.resume();
          if (p && p.catch) p.catch(() => {});
        }
        if (M.pending) { const m = M.pending; M.pending = null; Audio.music(m); }
      } catch (e) { initFailed = !ctx; }
    },

    play(name, opts) {
      try {
        if (!ready()) return;
        const r = SFX[name];
        if (!r) return;
        const vol = clamp(num(opts && opts.vol, 1), 0, 1);
        if (vol <= 0.001 || sfxVol <= 0.001) return;
        const nowMs = Date.now();
        if (nowMs - (lastPlay[name] || 0) < r.rate) return;
        const now = ctx.currentTime;
        for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end <= now) voices.splice(i, 1);
        if (voices.length >= MAX_VOICES) return;
        if (r.max) { let c = 0; for (const v of voices) if (v.name === name) c++; if (c >= r.max) return; }
        lastPlay[name] = nowMs;
        const pitch = clamp(num(opts && opts.pitch, 1), 0.25, 4);
        S.v = vol;
        S.p = pitch * (1 + (Math.random() * 2 - 1) * (r.jit || 0));
        const dur = r.fn(now + 0.005);
        S.v = 1; S.p = 1;
        voices.push({ name, end: now + (dur || 0.2) });
      } catch (e) { S.v = 1; S.p = 1; }
    },

    setSfxVolume(v) {
      sfxVol = clamp(num(v, sfxVol), 0, 1);
      try { if (ready()) setTarget(sfxBus.gain, sfxVol, ctx.currentTime, 0.03); } catch (e) { /* ignore */ }
    },

    setMusicVolume(v) {
      musicVol = clamp(num(v, musicVol), 0, 1);
      try { if (ready()) setTarget(musicGain.gain, musicVol * MUSIC_SCALE, ctx.currentTime, 0.05); } catch (e) { /* ignore */ }
    },

    music(mode) {
      try {
        if (!SONGS[mode] && mode !== 'off') return;
        if (!ready()) { M.pending = mode; return; }
        if (mode === M.mode) return;
        startMusic(mode);
      } catch (e) { /* ignore */ }
    },

    setIntensity(x) { M.intensity = clamp(num(x, 0), 0, 1); },

    pause() {
      try {
        paused = true;
        if (!ready()) return;
        const now = ctx.currentTime;
        setTarget(duckGain.gain, 0.3, now, 0.08);
        setTarget(duckLP.frequency, 650, now, 0.08);
      } catch (e) { /* ignore */ }
    },

    resume() {
      try {
        paused = false;
        if (!ready()) return;
        if (ctx.state === 'suspended') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
        const now = ctx.currentTime;
        setTarget(duckGain.gain, 1, now, 0.1);
        setTarget(duckLP.frequency, 20000, now, 0.12);
      } catch (e) { /* ignore */ }
    },

    isPaused() { return paused; },
  };

  PS.Audio = Audio;
})();
