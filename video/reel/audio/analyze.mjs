// Tempo, beat grid, downbeat and bar energy of an audio file (ffmpeg decode, plain-JS onset detection).
//   node audio/analyze.mjs <file> [--min 70] [--max 180] [--json] [--bars]
//   node audio/analyze.mjs <file> --check audio/cues.json     worst offset of the picture cuts from the grid
// Tempo: a comb filter over the log-spectral flux. Phase: the attack curve (dB rise of pre-emphasised
// energy at 1 kHz) folded on the beat period, then every attack within ±40 ms of the grid fitted by
// least squares. Downbeat: the beat phase where the level jumps most across bar lines.
import { spawnSync } from "node:child_process";

export const SR = 22050;
const N = 1024;
const HOP = 128;
const FR = SR / HOP;

export function decode(file, { ss, t } = {}) {
  const a = ["-v", "error", ...(ss != null ? ["-ss", String(ss)] : []), ...(t != null ? ["-t", String(t)] : []), "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"];
  const r = spawnSync("ffmpeg", a, { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// onset curves at FR frames per second: [full band flux, kick band flux, rms]
export function onsets(x) {
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const frames = Math.max(0, Math.floor((x.length - N) / HOP));
  const flux = new Float32Array(frames), kick = new Float32Array(frames), rms = new Float32Array(frames);
  const re = new Float64Array(N), im = new Float64Array(N);
  const bins = N / 2;
  const kb = Math.floor((160 * N) / SR);
  let prev = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = 0; i < N; i++) { const v = x[f * HOP + i]; re[i] = v * win[i]; im[i] = 0; e += v * v; }
    fft(re, im);
    let s = 0, k = 0;
    const cur = new Float64Array(bins);
    for (let b = 1; b < bins; b++) {
      cur[b] = Math.log1p(40 * Math.hypot(re[b], im[b]));
      const d = cur[b] - prev[b];
      if (d > 0) { s += d; if (b < kb) k += d; }
    }
    flux[f] = s; kick[f] = k; rms[f] = Math.sqrt(e / N);
    prev = cur;
  }
  return { flux, kick, rms, frames };
}

// score of a beat grid (period p frames, phase q frames) = mean onset strength on the grid
const at = (env, x) => {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= env.length) return 0;
  const f = x - i;
  return env[i] * (1 - f) + env[i + 1] * f;
};
const gridScore = (env, p, q) => {
  let s = 0, n = 0;
  for (let x = q; x < env.length - 1; x += p) { s += at(env, x); n++; }
  return n ? s / n : 0;
};

export function tempo(env, min = 70, max = 180) {
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  const norm = Float32Array.from(env, (v) => Math.max(0, v - mean));
  let best = { score: -1 };
  const results = [];
  for (let bpm = min; bpm <= max; bpm += 0.1) {
    const p = (60 * FR) / bpm;
    let top = 0, topq = 0;
    for (let q = 0; q < p; q += 0.5) { const s = gridScore(norm, p, q); if (s > top) { top = s; topq = q; } }
    results.push({ bpm, score: top, q: topq });
  }
  results.sort((a, b) => b.score - a.score);
  best = results[0];
  // refine
  let { bpm, q } = best, sc = best.score;
  for (let b = best.bpm - 0.15; b <= best.bpm + 0.15; b += 0.01) {
    const p = (60 * FR) / b;
    for (let qq = 0; qq < p; qq += 0.1) {
      const s = gridScore(norm, p, qq);
      if (s > sc) { sc = s; bpm = b; q = qq; }
    }
  }
  const alts = [];
  for (const r of results) if (alts.length < 5 && alts.every((a) => Math.abs(a.bpm - r.bpm) > 3)) alts.push({ bpm: +r.bpm.toFixed(1), score: +r.score.toFixed(3) });
  return { bpm, period: (60 * FR) / bpm, phaseFrames: q, score: sc, alts };
}

// Attack curve at 1 kHz: the rise in dB of a pre-emphasised (transient-weighted) short-time energy.
// Spectral flux peaks on the body of a kick or a bass note (~100 ms late here); this curve peaks on
// the attack itself, which is what the eye syncs to.
const AR = 1000;
export function attackCurve(x) {
  const hop = SR / AR, n = Math.floor(x.length / hop);
  const L = new Float32Array(n);
  let prev = 0;
  for (let f = 0; f < n; f++) {
    let e = 0;
    for (let i = Math.round(f * hop); i < Math.round((f + 1) * hop); i++) { const y = x[i] - 0.9 * prev; prev = x[i]; e += y * y; }
    L[f] = 10 * Math.log10(e / hop + 1e-10);
  }
  const S = Float32Array.from(L, (_, f) => (L[Math.max(0, f - 1)] + L[f] + L[Math.min(n - 1, f + 1)]) / 3);
  // rise over 4 ms against the quietest of the 12 ms before it
  return Float32Array.from(S, (v, f) => {
    if (f < 14 || f + 4 >= n) return 0;
    let lo = Infinity;
    for (let j = f - 12; j <= f; j++) lo = Math.min(lo, S[j]);
    return Math.max(0, S[f + 4] - lo);
  });
}

// Fold the attack curve on the beat period (1 ms bins): the bin where the curve climbs fastest is the beat phase.
function foldPhase(d, period) {
  const bins = Math.round(period * AR), acc = new Float64Array(bins), cnt = new Float64Array(bins);
  for (let f = 0; f < d.length; f++) { const k = Math.floor((((f / AR) % period) / period) * bins) % bins; acc[k] += d[f]; cnt[k]++; }
  const m = Array.from(acc, (v, k) => v / (cnt[k] || 1));
  let best = 0;
  for (let k = 1; k < bins; k++) if (m[k] > m[best]) best = k;
  return best / AR;
}

// Sample-accurate grid: the attack nearest each predicted beat (within ±40 ms), fitted to t = t0 + n * period
// by least squares, dropping hits more than 8 ms off the line.
export function refine(x, bpm) {
  const d = attackCurve(x);
  let period = 60 / bpm;
  let t0 = foldPhase(d, period);
  let pts = [];
  for (let pass = 0; pass < 3; pass++) {
    pts = [];
    for (let n = 0; t0 + n * period < d.length / AR - 0.05; n++) {
      const c = t0 + n * period;
      let best = 0, bi = -1;
      for (let f = Math.max(0, Math.round((c - 0.04) * AR)); f <= Math.round((c + 0.04) * AR); f++) if (d[f] > best) { best = d[f]; bi = f; }
      if (best > 6) pts.push([n, bi / AR]);
    }
    let keep = pts;
    for (let it = 0; it < 4 && keep.length > 2; it++) {
      const m = keep.length;
      const sn = keep.reduce((s, p) => s + p[0], 0), st = keep.reduce((s, p) => s + p[1], 0);
      const snn = keep.reduce((s, p) => s + p[0] * p[0], 0), snt = keep.reduce((s, p) => s + p[0] * p[1], 0);
      period = (m * snt - sn * st) / (m * snn - sn * sn);
      t0 = (st - period * sn) / m;
      keep = pts.filter((p) => Math.abs(p[1] - (t0 + period * p[0])) < 0.008);
    }
    pts = keep;
  }
  const res = pts.map((p) => (p[1] - (t0 + p[0] * period)) * 1000);
  const rmsMs = Math.sqrt(res.reduce((s, v) => s + v * v, 0) / res.length);
  return { bpm: 60 / period, period, t0, hits: pts.length, rmsMs, maxMs: Math.max(...res.map(Math.abs)) };
}

const rmsOf = (x, a, b) => {
  let e = 0, n = 0;
  for (let i = Math.max(0, Math.round(a * SR)); i < Math.min(x.length, Math.round(b * SR)); i++) { e += x[i] * x[i]; n++; }
  return Math.sqrt(e / (n || 1));
};
const dB = (v) => 20 * Math.log10(v + 1e-9);

export function analyze(file, opts = {}) {
  const x = decode(file, opts);
  const { flux } = onsets(x);
  const t = tempo(flux, opts.min || 70, opts.max || 180);
  const g = refine(x, t.bpm);
  const beatSec = g.period;
  const first = g.t0 - Math.floor(g.t0 / beatSec) * beatSec;
  // downbeat: arrangements change on bar lines, so the beat phase (0-3) where the level jumps most
  // (one bar after against one bar before) starts the bars
  const nb = Math.floor((x.length / SR - first) / beatSec);
  const jumps = [];
  for (let k = 4; k < nb - 4; k++) {
    const tk = first + k * beatSec;
    jumps.push({ k, t: tk, db: dB(rmsOf(x, tk, tk + 4 * beatSec)) - dB(rmsOf(x, tk - 4 * beatSec, tk)) });
  }
  const phaseScore = [0, 0, 0, 0];
  jumps.forEach((j) => { phaseScore[j.k % 4] += Math.max(0, j.db) ** 2; });
  const down = phaseScore.indexOf(Math.max(...phaseScore));
  const firstDown = first + down * beatSec;
  const barLen = 4 * beatSec;
  const bars = [];
  for (let b = 0; firstDown + (b + 1) * barLen <= x.length / SR + 1e-6; b++) {
    const a = firstDown + b * barLen;
    bars.push({ bar: b, t: +a.toFixed(4), db: +dB(rmsOf(x, a, a + barLen)).toFixed(1), beats: [0, 1, 2, 3].map((q) => +dB(rmsOf(x, a + q * beatSec, a + (q + 1) * beatSec)).toFixed(1)) });
  }
  const sections = jumps.filter((j) => j.k % 4 === down && Math.abs(j.db) >= 3).map((j) => ({ t: +j.t.toFixed(4), bar: Math.round((j.t - firstDown) / barLen), db: +j.db.toFixed(1) }));
  return { file, duration: +(x.length / SR).toFixed(3), bpm: +g.bpm.toFixed(4), beat: +beatSec.toFixed(6), fit: { hits: g.hits, rmsMs: +g.rmsMs.toFixed(2), maxMs: +g.maxMs.toFixed(2) }, firstBeat: +first.toFixed(4), downbeatBeat: down, firstDownbeat: +firstDown.toFixed(4), combBpm: +t.bpm.toFixed(3), alts: t.alts, phaseScore: phaseScore.map((v) => +v.toFixed(1)), sections, bars };
}

// how far each time lies from the nearest point of the grid (t0 + n * beat), in ms
export function offsets(times, t0, beat) {
  return times.map((t) => { const d = (((t - t0) % beat) + beat) % beat; return (d > beat / 2 ? d - beat : d) * 1000; });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
  const r = analyze(args[0], { min: +flag("min", 70), max: +flag("max", 180) });
  const check = flag("check", null);
  if (check) {
    // --check cues.json: how far each picture cut lies from the beat grid detected in this file's audio
    const { readFileSync } = await import("node:fs");
    const sheet = JSON.parse(readFileSync(check, "utf8"));
    const cuts = sheet.cuts.map((c) => c.t);
    const off = offsets(cuts, r.firstBeat, r.beat);
    const worst = off.reduce((m, v, i) => (Math.abs(v) > Math.abs(m.v) ? { v, i } : m), { v: 0, i: 0 });
    console.log(JSON.stringify({ file: r.file, bpm: r.bpm, beat: r.beat, firstBeat: r.firstBeat, fit: r.fit, cuts: cuts.length, worstMs: +worst.v.toFixed(2), worstAt: sheet.cuts[worst.i], meanAbsMs: +(off.reduce((s, v) => s + Math.abs(v), 0) / off.length).toFixed(2) }));
  } else if (args.includes("--json")) console.log(JSON.stringify(r));
  else {
    const { bars, ...rest } = r;
    console.log(JSON.stringify(rest));
    if (args.includes("--bars")) bars.forEach((b) => console.log(`bar ${String(b.bar).padStart(3)}  t=${b.t.toFixed(3).padStart(8)}  ${String(b.db).padStart(6)} dB  [${b.beats.map((v) => String(v).padStart(6)).join(" ")}]  ${"#".repeat(Math.max(0, Math.round((b.db + 40) * 1.2)))}`));
  }
}
