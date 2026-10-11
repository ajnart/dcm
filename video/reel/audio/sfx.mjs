// UI sound design laid over the music: synthesised from oscillators, noise and filters, no samples.
// Each cue kind in audio/cues.json maps to one sound; render() writes them into a dry and a reverb bus.
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const pan = (p) => [Math.cos(((clamp(p, -1, 1) + 1) * Math.PI) / 4), Math.sin(((clamp(p, -1, 1) + 1) * Math.PI) / 4)];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

class Biquad {
  constructor(sr, type, f, q = 0.707) { this.sr = sr; this.type = type; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(f, q); }
  set(f, q = this.q) {
    this.q = q;
    const w = (TAU * clamp(f, 10, this.sr * 0.45)) / this.sr, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
    let b0, b1, b2;
    if (this.type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (this.type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = a; b1 = 0; b2 = -a; }
    const a0 = 1 + a;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - a) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export function render(cues, N, SR) {
  const dry = { L: new Float32Array(N), R: new Float32Array(N) };
  const send = new Float32Array(N);
  const at = (t) => Math.round(t * SR);
  const add = (i, l, r = l, wet = 0) => { if (i >= 0 && i < N) { dry.L[i] += l; dry.R[i] += r; send[i] += (l + r) * 0.5 * wet; } };
  const bq = (type, f, q) => new Biquad(SR, type, f, q);

  function click(t0, g = 1, pitch = 3200, p = 0) {
    const i0 = at(t0), r = rng(Math.floor(t0 * 7919) + pitch), hp = bq("hp", 1800), [pl, pr] = pan(p);
    for (let k = 0; k < at(0.03); k++) {
      const t = k / SR;
      const v = (hp.run(r() * 2 - 1) * Math.exp(-t * 900) * 0.6 + Math.sin(TAU * pitch * t) * Math.exp(-t * 260) * 0.3) * g;
      add(i0 + k, v * pl, v * pr, 0.1);
    }
  }
  function thock(t0, g = 1, f0 = 110) {
    const i0 = at(t0);
    let ph = 0;
    for (let k = 0; k < at(0.18); k++) {
      const t = k / SR;
      ph += (f0 + f0 * 0.8 * Math.exp(-t * 40)) / SR;
      const v = Math.sin(TAU * ph) * Math.exp(-t * 22) * Math.min(1, t / 0.001) * 0.5 * g;
      add(i0 + k, v, v);
    }
  }
  function pop(t0, g = 1, p = 0, f0 = 900) {
    const i0 = at(t0), [pl, pr] = pan(p);
    let ph = 0;
    for (let k = 0; k < at(0.09); k++) {
      const t = k / SR;
      ph += (f0 * 0.35 + f0 * Math.exp(-t * 55)) / SR;
      const v = Math.sin(TAU * ph) * Math.exp(-t * 45) * Math.min(1, t / 0.001) * 0.28 * g;
      add(i0 + k, v * pl, v * pr, 0.15);
    }
  }
  function bell(t0, midi, g = 1, p = 0, dec = 5) {
    const i0 = at(t0), f = mtof(midi), [pl, pr] = pan(p);
    const parts = [[1, 1], [2.0, 0.4], [3.01, 0.18], [4.2, 0.08]];
    for (let k = 0; k < at(1.2); k++) {
      const t = k / SR;
      let v = 0;
      parts.forEach(([m, a], j) => { v += Math.sin(TAU * f * m * t) * a * Math.exp(-t * dec * (1 + j * 0.6)); });
      v *= Math.min(1, t / 0.002) * 0.16 * g;
      add(i0 + k, v * pl, v * pr, 0.4);
    }
  }
  function whoosh(t0, dur = 0.5, p = 0, g = 1, rising = false) {
    const len = at(dur * 1.3), i0 = at(t0 - dur * (rising ? 1 : 0.35)), b = bq("bp", 500, 1.1), lp = bq("lp", 6000), r = rng(Math.floor(t0 * 977));
    for (let k = 0; k < len; k++) {
      const x = k / len;
      if (k % 32 === 0) b.set(rising ? 250 + 4200 * x * x : 350 + 3800 * Math.sin(Math.PI * Math.min(1, x * 1.15)), 1.1);
      const env = rising ? Math.pow(x, 2.2) * (x < 0.77 ? 1 : Math.max(0, (1 - x) / 0.23)) : Math.pow(Math.sin(Math.PI * x), 1.6);
      const v = lp.run(b.run(r() * 2 - 1)) * env * 0.9 * g;
      const [pl, pr] = pan(p * (2 * x - 1));
      add(i0 + k, v * pl, v * pr, 0.3);
    }
  }
  function boom(t0, g = 1) {
    const i0 = at(t0), r = rng(77), lp = bq("lp", 900);
    let ph = 0;
    for (let k = 0; k < at(1.4); k++) {
      const t = k / SR;
      ph += (34 + 70 * Math.exp(-t * 6)) / SR;
      const v = (Math.sin(TAU * ph) * Math.exp(-t * 2.6) * 0.9 + lp.run(r() * 2 - 1) * Math.exp(-t * 9) * 0.4) * g;
      add(i0 + k, v, v, 0.25);
    }
  }
  function impact(t0, size = 1) {
    boom(t0, 0.8 * size);
    thock(t0, 0.9 * size, 70);
    const i0 = at(t0), hp = bq("hp", 2500), r = rng(Math.floor(t0 * 31));
    for (let k = 0; k < at(0.25); k++) {
      const v = hp.run(r() * 2 - 1) * Math.exp((-k / SR) * 22) * 0.45 * size;
      add(i0 + k, v, v * 0.9, 0.3);
    }
  }
  function zip(t0, g = 1, p = 0) {
    const i0 = at(t0), len = at(0.16), [pl, pr] = pan(p);
    let ph = 0;
    for (let k = 0; k < len; k++) {
      const x = k / len;
      ph += (500 + 1700 * x * x) / SR;
      const v = Math.sin(TAU * ph) * Math.sin(Math.PI * x) * 0.11 * g;
      add(i0 + k, v * pl, v * pr, 0.15);
    }
  }
  function fwip(t0, p = 0, g = 1) {
    const len = at(0.13), i0 = at(t0), b = bq("bp", 800, 1.6), r = rng(Math.floor(t0 * 389)), [pl, pr] = pan(p);
    for (let k = 0; k < len; k++) {
      const x = k / len;
      if (k % 16 === 0) b.set(700 + 3500 * x, 1.6);
      const v = b.run(r() * 2 - 1) * Math.sin(Math.PI * x) * 0.5 * g;
      add(i0 + k, v * pl, v * pr, 0.1);
    }
  }
  function slam(t0, g = 1, p = 0) {
    thock(t0, 0.8 * g, 90);
    click(t0, 0.5 * g, 1900, p);
    const i0 = at(t0), b = bq("bp", 1400, 0.8), r = rng(Math.floor(t0 * 613)), [pl, pr] = pan(p);
    for (let k = 0; k < at(0.12); k++) {
      const v = b.run(r() * 2 - 1) * Math.exp((-k / SR) * 30) * 0.5 * g;
      add(i0 + k, v * pl, v * pr, 0.35);
    }
  }

  const SFX = {
    key: (c) => click(c.t, 0.3, 2600 + ((c.i * 397) % 1400), ((c.i * 7) % 5) / 5 - 0.4),
    enter: (c) => { click(c.t, 0.6, 1800); thock(c.t, 0.45, 160); },
    whoosh: (c) => whoosh(c.t, c.dur || 0.5, c.pan ?? 0, c.soft ? 0.45 : 0.85),
    suck: (c) => whoosh(c.t, c.dur || 0.5, 0, 0.7, true),
    impact: (c) => impact(c.t, c.size ?? 1),
    pop: (c) => pop(c.t, c.soft ? 0.5 : 0.8, ((c.i % 7) - 3) / 4, 700 + (c.i % 7) * 70),
    check: (c) => bell(c.t, [76, 79, 81, 84, 86, 88, 91, 84, 88, 91][c.i % 10], 0.55, ((c.i % 7) - 3) / 5, 7),
    lock: (c) => { thock(c.t, 0.5, 140); click(c.t, 0.5, 2400 + (c.i % 4) * 160, (c.i % 4) / 2 - 0.75); click(c.t + 0.035, 0.3, 3600, (c.i % 4) / 2 - 0.75); },
    flip: (c) => { for (let i = 0; i < 8; i++) fwip(c.t + i * 0.03, (i % 4) / 1.5 - 1, 0.7); },
    zip: (c) => zip(c.t, 1, c.pan || 0),
    switch: (c) => { fwip(c.t, 0.3, 0.55); click(c.t + 0.02, 0.35, 3000, 0.3); },
    click: (c) => { click(c.t, 0.7, 2200); click(c.t + 0.07, 0.45, 2900); },
    success: (c) => { bell(c.t, 76, 0.7, -0.2, 3); bell(c.t + 0.12, 81, 0.75, 0.2, 2.5); },
    tick: (c) => click(c.t, c.soft ? 0.22 : 0.38, 4200, c.pan || 0),
    slam: (c) => slam(c.t, c.g ?? 1, c.pan || 0),
  };
  for (const c of cues) {
    if (!SFX[c.kind]) throw new Error(`no sound for cue kind "${c.kind}"`);
    SFX[c.kind](c);
  }
  return { dry, wet: reverb(send, N, SR) };
}

// a small Freeverb-style room for the bells, whooshes and hits
function reverb(x, N, SR, room = 0.82, damp = 0.3) {
  const out = { L: new Float32Array(N), R: new Float32Array(N) };
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map((n) => Math.round((n * SR) / 44100));
  const aps = [556, 441, 341, 225].map((n) => Math.round((n * SR) / 44100));
  [["L", 0], ["R", 23]].forEach(([ch, spread]) => {
    const y = out[ch];
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
      y[i] = s;
    }
  });
  return out;
}
