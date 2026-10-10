// Original soundtrack for the reel, synthesised offline from nothing but oscillators, noise, filters and
// a reverb written here. No samples, no recordings, no third-party music. Deterministic: the same
// cues.json always gives the same WAV.
//   node render.mjs cues      (writes audio/cues.json from the scenes' own timeline)
//   node audio/synth.mjs      (writes audio/out/soundtrack.wav, mixed to -14 LUFS, true peak <= -1 dBTP)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHEET = JSON.parse(await readFile(join(HERE, "cues.json"), "utf8"));
const SR = 48000;
const DUR = SHEET.duration;
const N = Math.ceil(DUR * SR);
const BEAT = 60 / SHEET.bpm;
const BAR = BEAT * 4;
const TARGET_LUFS = -14;
const TP_MAX = -1.0;
const section = (name) => SHEET.sections.find((s) => s.name === name).t;
const S = { build: section("build"), lift: section("lift"), drive: section("drive"), breakdown: section("breakdown"), rebuild: section("rebuild"), payoff: section("payoff") };

// ---------- primitives ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const TAU = Math.PI * 2;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const dbg = (db) => Math.pow(10, db / 20);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

class Bus {
  constructor() { this.L = new Float32Array(N); this.R = new Float32Array(N); }
  add(i, l, r = l) { if (i >= 0 && i < N) { this.L[i] += l; this.R[i] += r; } }
}

// RBJ biquad; set() may be called per block for sweeps
class Biquad {
  constructor(type, f, q = 0.707) { this.type = type; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(f, q); }
  set(f, q = this.q) {
    this.q = q;
    const w = (TAU * clamp(f, 10, SR * 0.45)) / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
    let b0, b1, b2;
    if (this.type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (this.type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = a; b1 = 0; b2 = -a; } // band-pass, 0 dB peak
    const a0 = 1 + a;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - a) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// band-limited saw (polyBLEP)
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function saw(phase, dt) { return 2 * phase - 1 - blep(phase, dt); }
function square(phase, dt) {
  let v = phase < 0.5 ? 1 : -1;
  v += blep(phase, dt);
  v -= blep((phase + 0.5) % 1, dt);
  return v;
}

const pan = (p) => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];
const at = (t) => Math.round(t * SR);

// ---------- buses ----------
const drums = new Bus(), bass = new Bus(), pads = new Bus(), lead = new Bus(), fx = new Bus(), verbSend = new Bus(), delaySend = new Bus();
const duck = new Float32Array(N).fill(1); // kick sidechain for bass and pads

// ---------- harmony ----------
// A minor: Am F C G, one chord per bar
const CHORDS = { Am: [57, 60, 64], F: [53, 57, 60], C: [55, 60, 64], G: [55, 59, 62], Dm: [57, 62, 65], E: [56, 59, 64] };
const ROOT = { Am: 45, F: 41, C: 48, G: 43, Dm: 38, E: 40 };
const PROG = ["Am", "F", "C", "G"];
const chordAt = (t) => {
  if (t >= S.payoff) { const k = t - S.payoff; return k < BAR ? "Am" : k < BAR * 1.5 ? "F" : k < BAR * 2 ? "G" : "Am"; }
  if (t >= S.breakdown && t < S.rebuild) return t - S.breakdown < BAR ? "F" : "G";
  const base = t >= S.rebuild ? S.rebuild : t >= S.lift ? S.lift : 0;
  return PROG[Math.floor((t - base) / BAR) % 4];
};

// ---------- instruments ----------
function kick(t0, g = 1) {
  const i0 = at(t0), len = at(0.42);
  let ph = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const f = 48 + 120 * Math.exp(-t * 28);
    ph += f / SR;
    const env = Math.exp(-t * 7.5) * (t < 0.002 ? t / 0.002 : 1);
    const click = k < 120 ? (1 - k / 120) * 0.35 * Math.sin(k * 0.9) : 0;
    const v = (Math.tanh(Math.sin(TAU * ph) * 1.6) * env + click) * 0.6 * g;
    drums.add(i0 + k, v);
  }
  for (let k = 0; k < at(0.28); k++) { const e = 0.38 + 0.62 * Math.pow(k / at(0.28), 0.7); const i = i0 + k; if (i < N) duck[i] = Math.min(duck[i], e); }
}
const noise = rng(1234);
function clap(t0, g = 1, p = 0) {
  const i0 = at(t0), bp = new Biquad("bp", 1900, 1.0), hp = new Biquad("hp", 800);
  const [pl, pr] = pan(p);
  for (let k = 0; k < at(0.3); k++) {
    const t = k / SR;
    const burst = [0, 0.011, 0.022].reduce((s, o) => s + (t >= o ? Math.exp(-(t - o) * 180) : 0), 0) + Math.exp(-t * 18) * 0.5;
    const v = hp.run(bp.run((noise() * 2 - 1) * burst)) * 1.1 * g;
    drums.add(i0 + k, v * pl, v * pr);
    verbSend.add(i0 + k, v * 0.25);
  }
}
function hat(t0, g = 1, open = false, p = 0) {
  const i0 = at(t0), hp = new Biquad("hp", 7500, 0.9), bp = new Biquad("bp", 10000, 0.8);
  const [pl, pr] = pan(p);
  const dec = open ? 9 : 55;
  for (let k = 0; k < at(open ? 0.32 : 0.07); k++) {
    const v = bp.run(hp.run(noise() * 2 - 1)) * Math.exp((-k / SR) * dec) * 0.5 * g;
    drums.add(i0 + k, v * pl, v * pr);
  }
}
function snareRoll(a, b, g = 1) {
  // a build: hits accelerate from eighths to 32nds and grow louder
  let t = a;
  while (t < b) {
    const p = (t - a) / (b - a);
    clap(t, g * (0.25 + 0.75 * p * p), (noise() - 0.5) * 0.3);
    t += p < 0.45 ? BEAT / 2 : p < 0.8 ? BEAT / 4 : BEAT / 8;
  }
}
function crash(t0, g = 1) {
  const i0 = at(t0), hp = new Biquad("hp", 4500, 0.7), r = rng(Math.floor(t0 * 1000));
  for (let k = 0; k < at(2.2); k++) {
    const v = hp.run(r() * 2 - 1) * Math.exp((-k / SR) * 2.4) * 0.22 * g;
    drums.add(i0 + k, v * (0.8 + 0.2 * r()), v * (0.8 + 0.2 * r()));
    verbSend.add(i0 + k, v * 0.4);
  }
}

// bass: saw through a resonant low-pass, notes given as [t, dur, midi, cutoff]
function bassNote(t0, dur, midi, cut = 600, g = 1) {
  const i0 = at(t0), len = at(dur + 0.04), f = mtof(midi), dt = f / SR;
  const lp = new Biquad("lp", cut, 1.4), lp2 = new Biquad("lp", cut * 1.5, 0.7);
  let ph = 0, ph2 = 0.3;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    if (k % 32 === 0) lp.set(cut * (1 + 2.2 * Math.exp(-t * 14)), 1.4);
    ph = (ph + dt) % 1; ph2 = (ph2 + dt * 1.004) % 1;
    const env = Math.min(1, t / 0.004) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.04));
    const sub = Math.sin(TAU * ph) * 0.45;
    const v = (lp2.run(lp.run(saw(ph, dt) * 0.5 + saw(ph2, dt) * 0.5)) * 0.55 + sub * 0.5) * env * 0.55 * g;
    bass.add(i0 + k, v);
  }
}

// pad: detuned saw stack, slow attack, gentle filter that can sweep with the arrangement
function padChord(t0, dur, notes, g = 1, cutA = 1200, cutB = cutA, att = 0.35) {
  const i0 = at(t0), len = at(dur + 0.6);
  const voices = [];
  notes.forEach((m, n) => [-0.11, -0.04, 0.04, 0.11].forEach((d, j) => voices.push({ f: mtof(m + d), ph: (n * 0.37 + j * 0.21) % 1, p: (j - 1.5) / 1.6 })));
  const lpL = new Biquad("lp", cutA, 0.8), lpR = new Biquad("lp", cutA, 0.8);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    if (k % 64 === 0) { const c = cutA + (cutB - cutA) * clamp(t / dur); lpL.set(c, 0.8); lpR.set(c, 0.8); }
    const env = Math.min(1, t / att) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.6));
    let l = 0, r = 0;
    for (const v of voices) {
      v.ph = (v.ph + v.f / SR) % 1;
      const s = saw(v.ph, v.f / SR);
      l += s * (0.5 - v.p * 0.4); r += s * (0.5 + v.p * 0.4);
    }
    const sc = 0.055 * env * g;
    const L = lpL.run(l) * sc, R = lpR.run(r) * sc;
    pads.add(i0 + k, L, R);
    verbSend.add(i0 + k, (L + R) * 0.18);
  }
}

// pluck: square + saw with a fast filter envelope, for arps and stabs
function pluck(t0, midi, g = 1, p = 0, bright = 2600, dec = 9, dly = 0.35) {
  const i0 = at(t0), len = at(0.5), f = mtof(midi), dt = f / SR, lp = new Biquad("lp", bright, 2.2);
  const [pl, pr] = pan(p);
  let ph = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    if (k % 32 === 0) lp.set(300 + bright * Math.exp(-t * 16), 2.2);
    ph = (ph + dt) % 1;
    const env = Math.min(1, t / 0.002) * Math.exp(-t * dec);
    const v = lp.run(square(ph, dt) * 0.5 + saw(ph, dt) * 0.5) * env * 0.16 * g;
    lead.add(i0 + k, v * pl, v * pr);
    delaySend.add(i0 + k, v * dly * pl, v * dly * pr);
  }
}

// bell: inharmonic sines for UI chimes
function bell(t0, midi, g = 1, p = 0, dec = 5, bus = fx) {
  const i0 = at(t0), f = mtof(midi), [pl, pr] = pan(p);
  const parts = [[1, 1], [2.0, 0.4], [3.01, 0.18], [4.2, 0.08]];
  for (let k = 0; k < at(1.4); k++) {
    const t = k / SR;
    let v = 0;
    parts.forEach(([m, a], j) => { v += Math.sin(TAU * f * m * t) * a * Math.exp(-t * dec * (1 + j * 0.6)); });
    v *= Math.min(1, t / 0.002) * 0.16 * g;
    bus.add(i0 + k, v * pl, v * pr);
    verbSend.add(i0 + k, v * 0.35);
  }
}

// lead: two detuned saws, a little vibrato, through a gentle low-pass; notes as [beat, midi, beats]
function leadNote(t0, dur, midi, g = 1, p = 0) {
  const i0 = at(t0), len = at(dur + 0.12), f = mtof(midi), lp = new Biquad("lp", 3200, 0.9), [pl, pr] = pan(p);
  let a = 0, b = 0.5;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const vib = 1 + 0.004 * Math.sin(TAU * 5.5 * t) * clamp((t - 0.15) / 0.2);
    a = (a + (f * vib) / SR) % 1; b = (b + (f * vib * 1.006) / SR) % 1;
    const env = Math.min(1, t / 0.01) * (t < dur ? 0.85 + 0.15 * Math.exp(-t * 6) : Math.max(0, 1 - (t - dur) / 0.12));
    const v = lp.run(saw(a, f / SR) + saw(b, f / SR)) * env * 0.075 * g;
    lead.add(i0 + k, v * pl, v * pr);
    delaySend.add(i0 + k, v * 0.3 * pl, v * 0.3 * pr);
    verbSend.add(i0 + k, v * 0.25);
  }
}
const MOTIF_A = [[0, 76, 1], [1, 74, 0.5], [1.5, 72, 0.5], [2, 69, 1.5], [3.5, 72, 0.5], [4, 74, 1], [5, 76, 0.5], [5.5, 79, 0.5], [6, 76, 1], [7, 74, 1]];
const MOTIF_B = [[0, 72, 1], [1, 74, 0.5], [1.5, 76, 0.5], [2, 79, 1], [3, 81, 1], [4, 79, 0.5], [4.5, 76, 0.5], [5, 74, 1], [6, 72, 1], [7, 69, 1]];
const melody = (t0, motif, g = 1, until = Infinity) => motif.forEach(([b, m, d]) => { const t = t0 + b * BEAT; if (t < until - 0.05) leadNote(t, Math.min(d * BEAT * 0.92, until - t - 0.05), m, g, 0); });

// ---------- sound design ----------
function whoosh(t0, dur = 0.5, p = 0, g = 1, rising = false) {
  const len = at(dur * 1.3), i0 = at(t0 - dur * 0.35), bp = new Biquad("bp", 500, 1.1), lp = new Biquad("lp", 6000), r = rng(Math.floor(t0 * 977));
  for (let k = 0; k < len; k++) {
    const x = k / len;
    if (k % 32 === 0) bp.set(rising ? 250 + 4200 * x * x : 350 + 3800 * Math.sin(Math.PI * Math.min(1, x * 1.15)), 1.1);
    const env = rising ? Math.pow(x, 2.2) * (x < 0.97 ? 1 : (1 - x) / 0.03) : Math.pow(Math.sin(Math.PI * x), 1.6);
    const v = lp.run(bp.run(r() * 2 - 1)) * env * 0.9 * g;
    const pp = p * (2 * x - 1);
    const [pl, pr] = pan(clamp(pp, -1, 1));
    fx.add(i0 + k, v * pl, v * pr);
    verbSend.add(i0 + k, v * 0.3);
  }
}
function boom(t0, g = 1) {
  const i0 = at(t0), r = rng(77), lp = new Biquad("lp", 900);
  let ph = 0;
  for (let k = 0; k < at(2.0); k++) {
    const t = k / SR;
    ph += (34 + 70 * Math.exp(-t * 6)) / SR;
    const v = (Math.sin(TAU * ph) * Math.exp(-t * 2.2) * 0.9 + lp.run(r() * 2 - 1) * Math.exp(-t * 9) * 0.5) * g;
    fx.add(i0 + k, v);
    verbSend.add(i0 + k, v * 0.3);
  }
  crash(t0, 0.9 * g);
}
function impact(t0, size = 1) {
  boom(t0, 0.8 * size);
  kick(t0, 1.1 * size);
  const i0 = at(t0), hp = new Biquad("hp", 2500), r = rng(Math.floor(t0 * 31));
  for (let k = 0; k < at(0.25); k++) {
    const v = hp.run(r() * 2 - 1) * Math.exp((-k / SR) * 22) * 0.5 * size;
    fx.add(i0 + k, v, v * 0.9);
  }
}
function riser(t0, dur, g = 1) {
  const i0 = at(t0), len = at(dur), bp = new Biquad("bp", 300, 2), r = rng(Math.floor(t0 * 1013));
  let ph = 0;
  for (let k = 0; k < len; k++) {
    const x = k / len;
    if (k % 32 === 0) bp.set(300 + 7000 * x * x, 2);
    const f = 180 * Math.pow(8, x);
    ph = (ph + f / SR) % 1;
    const env = Math.pow(x, 1.8);
    const v = (bp.run(r() * 2 - 1) * 0.8 + saw(ph, f / SR) * 0.06) * env * 0.5 * g;
    const w = Math.sin(TAU * x * dur * 6) * 0.4 * x;
    fx.add(i0 + k, v * (1 - w * 0.5), v * (1 + w * 0.5));
    verbSend.add(i0 + k, v * 0.3);
  }
}
function click(t0, g = 1, pitch = 3200, p = 0) {
  const i0 = at(t0), r = rng(Math.floor(t0 * 7919)), hp = new Biquad("hp", 1800), [pl, pr] = pan(p);
  for (let k = 0; k < at(0.03); k++) {
    const t = k / SR;
    const v = (hp.run(r() * 2 - 1) * Math.exp(-t * 900) * 0.6 + Math.sin(TAU * pitch * t) * Math.exp(-t * 260) * 0.3) * g;
    fx.add(i0 + k, v * pl, v * pr);
  }
}
function thock(t0, g = 1, f0 = 110) {
  const i0 = at(t0);
  let ph = 0;
  for (let k = 0; k < at(0.18); k++) {
    const t = k / SR;
    ph += (f0 + f0 * 0.8 * Math.exp(-t * 40)) / SR;
    fx.add(i0 + k, Math.sin(TAU * ph) * Math.exp(-t * 22) * 0.5 * g);
  }
}
function pop(t0, g = 1, p = 0, f0 = 900) {
  const i0 = at(t0), [pl, pr] = pan(p);
  let ph = 0;
  for (let k = 0; k < at(0.09); k++) {
    const t = k / SR;
    ph += (f0 * 0.35 + f0 * Math.exp(-t * 55)) / SR;
    const v = Math.sin(TAU * ph) * Math.exp(-t * 45) * Math.min(1, t / 0.001) * 0.28 * g;
    fx.add(i0 + k, v * pl, v * pr);
  }
}
function zip(t0, g = 1) {
  const i0 = at(t0), len = at(0.16);
  let ph = 0;
  for (let k = 0; k < len; k++) {
    const x = k / len;
    ph += (500 + 1700 * x * x) / SR;
    const v = Math.sin(TAU * ph) * Math.sin(Math.PI * x) * 0.09 * g;
    fx.add(i0 + k, v * (1 - x * 0.5), v * (0.5 + x * 0.5));
  }
}
function lock(t0, i) {
  thock(t0, 0.55, 140);
  click(t0, 0.55, 2400 + (i % 4) * 160, (i % 4) / 2 - 0.75);
  click(t0 + 0.035, 0.35, 3600, (i % 4) / 2 - 0.75);
}
function fwip(t0, p = 0, g = 1) {
  const len = at(0.13), i0 = at(t0), bp = new Biquad("bp", 800, 1.6), r = rng(Math.floor(t0 * 389)), [pl, pr] = pan(p);
  for (let k = 0; k < len; k++) {
    const x = k / len;
    if (k % 16 === 0) bp.set(700 + 3500 * x, 1.6);
    const v = bp.run(r() * 2 - 1) * Math.sin(Math.PI * x) * 0.5 * g;
    fx.add(i0 + k, v * pl, v * pr);
  }
}

// ---------- arrangement ----------
const beatsIn = (a, b) => { const out = []; for (let t = Math.ceil(a / BEAT - 1e-6) * BEAT; t < b - 1e-6; t += BEAT) out.push(+t.toFixed(4)); return out; };

// build (0 - 9): pad swell, muted pulse, arps from the wall, kick from 3 s, snare build into the lift
padChord(0, 2, CHORDS.Am, 0.7, 380, 900, 1.2);
padChord(2, 2, CHORDS.F, 0.8, 900, 1300, 0.4);
padChord(4, 2, CHORDS.C, 0.9, 1300, 1800, 0.3);
padChord(6, 2, CHORDS.G, 1.0, 1800, 2600, 0.3);
padChord(8, 0.9, CHORDS.Am, 1.0, 2600, 4200, 0.2);
for (let t = 1.0; t < 8.9; t += BEAT / 2) bassNote(t, BEAT / 2 - 0.03, ROOT[chordAt(t)] + (Math.round(t / (BEAT / 2)) % 4 === 3 ? 12 : 0), 260 + 500 * (t / 9), 0.45 + 0.4 * (t / 9));
beatsIn(3, 8.5).forEach((t) => kick(t, 0.55 + 0.25 * ((t - 3) / 5.5)));
beatsIn(3, 8.5).forEach((t) => hat(t + BEAT / 2, 0.5 + 0.4 * ((t - 3) / 5.5), false, 0.3));
for (let t = 3.0; t < 8.9; t += BEAT / 4) {
  const ch = CHORDS[chordAt(t)], n = Math.round((t - 3) / (BEAT / 4));
  pluck(t, ch[n % 3] + 12 + (n % 8 >= 6 ? 12 : 0), 0.45 + 0.4 * ((t - 3) / 6), n % 2 ? 0.35 : -0.35, 900 + 2200 * ((t - 3) / 6), 12, 0.3);
}
snareRoll(7.0, 8.9, 0.8);
riser(7.2, 1.75, 1.0);

// lift (9 - 22) and drive (22 - 31): full groove
function groove(a, b, bright, drive) {
  beatsIn(a, b).forEach((t, n) => {
    kick(t, 1);
    if (n % 2 === 1) clap(t, 0.8, 0);
    hat(t + BEAT / 2, 0.85, n % 4 === 3, 0.25);
    hat(t + BEAT / 4, 0.35, false, -0.3);
    hat(t + (BEAT * 3) / 4, 0.4, false, -0.3);
    if (drive) hat(t, 0.25, false, 0.5);
  });
  for (let t = a; t < b - 1e-6; t += BEAT / 2) {
    const n = Math.round((t - a) / (BEAT / 2));
    const r = ROOT[chordAt(t)];
    bassNote(t + (n % 2 ? 0 : 0.0), BEAT / 2 - 0.04, r + ([0, 12, 0, 0, 12, 0, 7, 12][n % 8]), 520 + (drive ? 380 : 120), 1);
  }
  for (let bar = a; bar < b - 1e-6; bar += BAR) {
    const ch = chordAt(bar);
    padChord(bar, Math.min(BAR, b - bar) - 0.05, CHORDS[ch], 1.0, 2400 + (drive ? 900 : 0), 3400 + (drive ? 1400 : 0), 0.08);
  }
  for (let t = a; t < b - 1e-6; t += BEAT / 4) {
    const n = Math.round((t - a) / (BEAT / 4)), ch = CHORDS[chordAt(t)];
    const pat = [0, 1, 2, 1, 0, 2, 1, 2];
    const m = ch[pat[n % 8]] + 12 + (bright && n % 16 >= 12 ? 12 : 0);
    if (n % 16 === 14 && !bright) continue;
    pluck(t, m, 0.75, n % 2 ? 0.45 : -0.45, bright ? 3800 : 2600, 10, 0.4);
  }
}
groove(S.lift, S.drive, false, false);
melody(S.lift + BAR * 4, MOTIF_A, 0.9, S.drive);
melody(S.lift + BAR * 6, MOTIF_B, 0.9, S.drive);
melody(S.drive, MOTIF_A, 0.6, S.breakdown);
melody(S.drive + BAR * 2, MOTIF_B, 0.6, S.breakdown);
melody(S.drive + BAR * 4, MOTIF_A, 0.6, S.breakdown);
groove(S.drive, S.breakdown, true, true);
crash(S.lift, 1);
crash(S.drive, 0.7);
// a short "drop" breath before the lift: everything but the boom ducks for 60 ms
for (let k = at(S.lift - 0.08); k < at(S.lift); k++) duck[k] = Math.min(duck[k], 0.15);

// breakdown (31 - 35): drums out, low pad and sub, long reverb
padChord(S.breakdown, BAR - 0.05, CHORDS.F, 1.25, 600, 900, 0.25);
padChord(S.breakdown + BAR, S.rebuild - S.breakdown - BAR - 0.05, CHORDS.G, 1.25, 900, 1600, 0.25);
bassNote(S.breakdown, BAR - 0.1, ROOT.F, 220, 0.45);
bassNote(S.breakdown + BAR, S.rebuild - S.breakdown - BAR - 0.1, ROOT.G, 260, 0.45);
[0, 0.75, 1.5, 2.5, 3.0].forEach((o, i) => pluck(S.breakdown + 0.5 + o, [72, 76, 74, 79, 76][i], 0.5, i % 2 ? 0.5 : -0.5, 1800, 4, 0.6));
riser(S.rebuild - 1.0, 0.95, 0.5);

// rebuild (35 - 47): half-time, filter opening, arps from 39, snare build into the payoff
beatsIn(S.rebuild, S.payoff - 0.2).forEach((t, n) => {
  const p = (t - S.rebuild) / (S.payoff - S.rebuild);
  if (n % 2 === 0) kick(t, 0.8);
  if (n % 4 === 2) clap(t, 0.55, 0);
  hat(t + BEAT / 2, 0.55 + 0.35 * p, false, 0.25);
  if (p > 0.35) hat(t + BEAT / 4, 0.3 * p, false, -0.3);
});
for (let t = S.rebuild; t < S.payoff - 0.3; t += BEAT / 2) {
  const p = (t - S.rebuild) / (S.payoff - S.rebuild);
  bassNote(t, BEAT / 2 - 0.05, ROOT[chordAt(t)] + (Math.round(t / (BEAT / 2)) % 2 ? 12 : 0), 300 + 700 * p, 0.8);
}
for (let bar = S.rebuild; bar < S.payoff - 0.3; bar += BAR) {
  const p = (bar - S.rebuild) / (S.payoff - S.rebuild);
  padChord(bar, Math.min(BAR, S.payoff - 0.3 - bar) - 0.05, CHORDS[chordAt(bar)], 0.95, 900 + 1500 * p, 1300 + 1800 * p, 0.15);
}
for (let t = S.rebuild + 4; t < S.payoff - 0.3; t += BEAT / 4) {
  const n = Math.round((t - S.rebuild) / (BEAT / 4)), ch = CHORDS[chordAt(t)];
  const p = (t - S.rebuild - 4) / (S.payoff - S.rebuild - 4);
  pluck(t, ch[[0, 2, 1, 2][n % 4]] + 12, 0.35 + 0.4 * p, n % 2 ? 0.4 : -0.4, 1400 + 2400 * p, 11, 0.35);
}
snareRoll(S.payoff - 1.9, S.payoff - 0.12, 0.85);
for (let k = at(S.payoff - 0.1); k < at(S.payoff); k++) duck[k] = Math.min(duck[k], 0.1);

// payoff (47 - end): impact, two bars of groove, then the last chord rings while the end card holds still
const LAST = S.payoff + BAR * 2;
beatsIn(S.payoff, LAST).forEach((t, n) => {
  kick(t, 1);
  if (n % 2 === 1) clap(t, 0.85, 0);
  hat(t + BEAT / 2, 0.85, n % 4 === 3, 0.25);
  hat(t + BEAT / 4, 0.35, false, -0.3);
});
for (let t = S.payoff; t < LAST - 1e-6; t += BEAT / 2) {
  const n = Math.round((t - S.payoff) / (BEAT / 2));
  bassNote(t, BEAT / 2 - 0.04, ROOT[chordAt(t)] + [0, 12, 0, 7][n % 4], 900, 1);
}
melody(S.payoff, MOTIF_A, 1.1, LAST);
padChord(S.payoff, BAR - 0.05, CHORDS.Am, 1.15, 2600, 3800, 0.03);
padChord(S.payoff + BAR, BAR / 2 - 0.05, CHORDS.F, 1.15, 3000, 3600, 0.03);
padChord(S.payoff + BAR * 1.5, BAR / 2 - 0.05, CHORDS.G, 1.15, 3200, 3800, 0.03);
for (let t = S.payoff; t < LAST - 1e-6; t += BEAT / 4) {
  const n = Math.round((t - S.payoff) / (BEAT / 4)), ch = CHORDS[chordAt(t)];
  pluck(t, ch[[0, 1, 2, 1, 2, 0, 1, 2][n % 8]] + 24, 0.6, n % 2 ? 0.5 : -0.5, 4200, 10, 0.45);
}
// the final chord: A minor add 9 across four octaves, a crash and a soft kick, then a long tail
kick(LAST, 0.9);
crash(LAST, 0.9);
padChord(LAST, DUR - LAST - 0.65, [45, 57, 60, 64, 71, 76], 1.2, 2400, 900, 0.02);
bassNote(LAST, DUR - LAST - 0.9, 33, 200, 0.9);
[69, 72, 76, 81].forEach((m, i) => bell(LAST + i * 0.06, m, 0.55, (i - 1.5) / 2, 1.6, lead));

// ---------- cues ----------
for (const c of SHEET.cues) {
  const t = c.t;
  switch (c.kind) {
    case "whoosh": whoosh(t, c.dur || 0.5, c.pan ?? 0, c.soft ? 0.45 : 0.85); break;
    case "suck": whoosh(t, c.dur || 0.3, 0, 0.7, true); break;
    case "boom": boom(t, 1); break;
    case "impact": impact(t, c.size ?? 1); break;
    case "riser": riser(t, c.dur || 1, 0.85); break;
    case "thump": thock(t, 0.45, 95 + (c.i % 4) * 12); break;
    case "lock": lock(t, c.i); break;
    case "flip": for (let i = 0; i < 8; i++) fwip(t + i * 0.04, (i % 4) / 1.5 - 1, 0.7); break;
    case "key": click(t, 0.32, 2600 + (c.i * 397) % 1400, ((c.i * 7) % 5) / 5 - 0.4); break;
    case "enter": click(t, 0.6, 1800); thock(t, 0.4, 160); break;
    case "pop": pop(t, c.soft ? 0.45 : 0.75, ((c.i % 7) - 3) / 4, 700 + (c.i % 7) * 70); break;
    case "check": bell(t, [76, 79, 81, 84, 86, 88, 91, 84, 88, 91][c.i % 10], 0.5, ((c.i % 7) - 3) / 5, 7); break;
    case "tick": click(t, c.soft ? 0.25 : 0.4, 4200); break;
    case "zip": zip(t, 1); break;
    case "pass": whoosh(t + (c.dur || 0.5) * 0.4, c.dur || 0.5, -0.8, 0.3); bell(t + (c.dur || 0.5), 88, 0.3, -0.6, 9); break;
    case "plink": bell(t, 81, 0.9, 0.2, 2.2, lead); break;
    case "switch": fwip(t, 0.3, 0.55); click(t + 0.02, 0.3, 3000, 0.3); break;
    case "shimmer": [76, 79, 81, 84, 88, 91].forEach((m, i) => bell(t + i * 0.07, m, 0.45, (i - 2.5) / 3, 4)); break;
    case "click": click(t, 0.7, 2200); click(t + 0.07, 0.45, 2900); break;
    case "success": bell(t, 76, 0.7, -0.2, 3); bell(t + 0.12, 81, 0.75, 0.2, 2.5); break;
    default: throw new Error(`no sound for cue kind "${c.kind}"`);
  }
}

// ---------- effects and mix ----------
// tempo-synced ping-pong delay (dotted eighth)
function pingPong(src, time, fb, mix) {
  const d = at(time), L = new Float32Array(N), R = new Float32Array(N);
  const lpL = new Biquad("lp", 3500), lpR = new Biquad("lp", 3500);
  for (let i = 0; i < N; i++) {
    const dl = i >= d ? R[i - d] : 0, dr = i >= d ? L[i - d] : 0;
    L[i] = src.L[i] + lpL.run(dl) * fb;
    R[i] = src.R[i] * 0.3 + lpR.run(dr) * fb;
  }
  for (let i = 0; i < N; i++) { lead.L[i] += (L[i] - src.L[i]) * mix; lead.R[i] += (R[i] - src.R[i] * 0.3) * mix; }
}
pingPong(delaySend, BEAT * 0.75, 0.42, 0.8);

// Schroeder/Freeverb-style reverb
function reverb(src, room = 0.86, damp = 0.3, wet = 0.9) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map((n) => Math.round((n * SR) / 44100));
  const aps = [556, 441, 341, 225].map((n) => Math.round((n * SR) / 44100));
  const out = new Bus();
  [["L", 0], ["R", 23]].forEach(([ch, spread]) => {
    const x = src[ch], y = out[ch];
    const cb = combs.map((n) => ({ buf: new Float32Array(n + spread), i: 0, f: 0 }));
    const ab = aps.map((n) => ({ buf: new Float32Array(n + spread), i: 0 }));
    for (let i = 0; i < N; i++) {
      const inp = x[i] * 0.015;
      let s = 0;
      for (const c of cb) {
        const o = c.buf[c.i];
        c.f = o * (1 - damp) + c.f * damp;
        c.buf[c.i] = inp + c.f * room;
        c.i = (c.i + 1) % c.buf.length;
        s += o;
      }
      for (const a of ab) {
        const o = a.buf[a.i];
        a.buf[a.i] = s + o * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        s = o - s;
      }
      y[i] = s * wet;
    }
  });
  return out;
}
const verb = reverb(verbSend);

const L = new Float32Array(N), R = new Float32Array(N);
const lvl = { drums: dbg(-3), bass: dbg(-7.5), pads: dbg(-0.5), lead: dbg(-1), fx: dbg(-3), verb: dbg(-3) };
const busHp = [new Biquad("hp", 28), new Biquad("hp", 28)];
for (let i = 0; i < N; i++) {
  const d = duck[i];
  let l = drums.L[i] * lvl.drums + bass.L[i] * lvl.bass * d + pads.L[i] * lvl.pads * (0.55 + 0.45 * d) + lead.L[i] * lvl.lead * (0.75 + 0.25 * d) + fx.L[i] * lvl.fx + verb.L[i] * lvl.verb;
  let r = drums.R[i] * lvl.drums + bass.R[i] * lvl.bass * d + pads.R[i] * lvl.pads * (0.55 + 0.45 * d) + lead.R[i] * lvl.lead * (0.75 + 0.25 * d) + fx.R[i] * lvl.fx + verb.R[i] * lvl.verb;
  L[i] = busHp[0].run(l);
  R[i] = busHp[1].run(r);
}
// fade in over 20 ms and out over the last 0.6 s so the last frame lands on silence, not a cut
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const g = Math.min(1, t / 0.02) * Math.min(1, (DUR - t) / 0.6);
  L[i] *= g; R[i] *= g;
}

// ---------- master: gain to the loudness target, then a look-ahead limiter under the true-peak ceiling ----------
// linear up to 80 % of the ceiling, then a tanh shoulder that never passes it
function knee(y, ceil) {
  const k = 0.8 * ceil, a = Math.abs(y);
  return a <= k ? y : Math.sign(y) * (k + (ceil - k) * Math.tanh((a - k) / (ceil - k)));
}
function limit(inL, inR, gain, ceilDb) {
  const ceil = dbg(ceilDb), look = at(0.004), rel = Math.exp(-1 / (0.08 * SR));
  const oL = new Float32Array(N), oR = new Float32Array(N);
  // the gain each sample needs, then a running minimum over the look-ahead window, smoothed on release
  const need = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // 4x linear-interpolated peak estimate between samples catches most inter-sample overs
    const a = Math.max(Math.abs(inL[i]), Math.abs(inR[i])) * gain;
    const b = i + 1 < N ? Math.max(Math.abs(inL[i + 1]), Math.abs(inR[i + 1])) * gain : a;
    const pk = Math.max(a, b, Math.abs((inL[i] + (inL[i + 1] ?? 0)) / 2) * gain * 1.1, Math.abs((inR[i] + (inR[i + 1] ?? 0)) / 2) * gain * 1.1);
    need[i] = pk > ceil ? ceil / pk : 1;
  }
  let g = 1;
  const win = [];
  for (let i = 0; i < N; i++) {
    const j = i + look;
    const nj = j < N ? need[j] : 1;
    while (win.length && win[win.length - 1][1] >= nj) win.pop();
    win.push([j, nj]);
    while (win[0][0] < i) win.shift();
    const target = win[0][1];
    g = target < g ? target : target + (g - target) * rel;
    oL[i] = knee(inL[i] * gain * g, ceil);
    oR[i] = knee(inR[i] * gain * g, ceil);
  }
  return [oL, oR];
}

function wav(l, r) {
  const data = Buffer.alloc(N * 8);
  for (let i = 0; i < N; i++) { data.writeFloatLE(l[i], i * 8); data.writeFloatLE(r[i], i * 8 + 4); }
  const h = Buffer.alloc(58);
  h.write("RIFF", 0); h.writeUInt32LE(50 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(18, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 8, 28); h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34); h.writeUInt16LE(0, 36);
  h.write("fact", 38); h.writeUInt32LE(4, 42); h.writeUInt32LE(N, 46);
  h.write("data", 50); h.writeUInt32LE(data.length, 54);
  return Buffer.concat([h, data]);
}
function measure(file) {
  const p = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const s = p.stderr.slice(p.stderr.lastIndexOf("Summary:"));
  return { I: +s.match(/I:\s+(-?[\d.]+) LUFS/)[1], TP: +s.match(/Peak:\s+(-?[\d.inf]+) dBFS/)[1], LRA: +s.match(/LRA:\s+(-?[\d.]+) LU/)[1] };
}

const OUTDIR = join(HERE, "out");
await mkdir(OUTDIR, { recursive: true });
const file = join(OUTDIR, "soundtrack.wav");
let gainDb = 0, ceilDb = -1.6, m;
for (let pass = 1; pass <= 8; pass++) {
  const [oL, oR] = limit(L, R, dbg(gainDb), ceilDb);
  await writeFile(file, wav(oL, oR));
  m = measure(file);
  console.log(`pass ${pass}: gain ${gainDb.toFixed(2)} dB, ceiling ${ceilDb.toFixed(2)} dBFS -> ${m.I.toFixed(2)} LUFS, true peak ${m.TP.toFixed(2)} dBTP, LRA ${m.LRA} LU`);
  const okI = Math.abs(m.I - TARGET_LUFS) <= 0.3, okTP = m.TP <= TP_MAX;
  if (okI && okTP) break;
  if (!okTP) ceilDb -= m.TP - TP_MAX + 0.15;
  gainDb += TARGET_LUFS - m.I;
}
if (Math.abs(m.I - TARGET_LUFS) > 0.3 || m.TP > TP_MAX) { console.error("could not reach the loudness target"); process.exit(1); }
console.log(`wrote ${file}: ${DUR} s, 48 kHz stereo, ${m.I.toFixed(1)} LUFS integrated, ${m.TP.toFixed(1)} dBTP`);
