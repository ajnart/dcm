// The reel's soundtrack: an edit of "Let's Move" (Michael Ramir C., Mixkit Stock Music Free License, see
// audio/SOURCES.md) cut on its own bar lines, plus the UI sound design of audio/sfx.mjs, mastered to
// -14 LUFS integrated under -1 dBTP. Deterministic: the same track and cues.json always give the same WAV.
//   node render.mjs cues      (writes audio/cues.json from the scenes' own timeline)
//   node audio/mix.mjs        (downloads and verifies the track if needed, writes audio/out/soundtrack.wav)
// Both take --cut <name> (default media): saas mixes the "Replace the SaaS you pay for" cut from saas/timeline.js and
// audio/cues-saas.json into audio/out/soundtrack-saas.wav, on the same track and grid.
// The licence lets the track be used in a video but not redistributed on its own, so the MP3 is not
// committed: it is fetched from Mixkit's CDN into audio/track/ (git-ignored) and checked against its SHA-1.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "./analyze.mjs";
import { render as renderSfx } from "./sfx.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const cutAt = process.argv.indexOf("--cut");
const CUT = cutAt < 0 ? "media" : process.argv[cutAt + 1];
const SFX = CUT === "media" ? "" : `-${CUT}`;
const { EDIT, DUR, BAR } = await import(CUT === "media" ? "../timeline.js" : `../${CUT}/timeline.js`);
export const TRACK = {
  file: join(HERE, "track", "lets-move.mp3"),
  url: "https://assets.mixkit.co/music/836/836.mp3",
  sha1: "3d3cdda4224877867b9af506a5d3a5c12ea63b8f",
};
const SR = 48000;
const N = Math.round(DUR * SR);
const TARGET_LUFS = -14;
const TP_MAX = -1.0;
const dbg = (db) => Math.pow(10, db / 20);
const at = (t) => Math.round(t * SR);

async function ensureTrack() {
  try { await access(TRACK.file); }
  catch {
    console.log(`fetching ${TRACK.url}`);
    const r = await fetch(TRACK.url);
    if (!r.ok) throw new Error(`download failed: HTTP ${r.status}`);
    await mkdir(dirname(TRACK.file), { recursive: true });
    await writeFile(TRACK.file, Buffer.from(await r.arrayBuffer()));
  }
  const sum = createHash("sha1").update(await readFile(TRACK.file)).digest("hex");
  if (sum !== TRACK.sha1) throw new Error(`${TRACK.file}: SHA-1 ${sum}, expected ${TRACK.sha1}`);
}

function decodeStereo(file) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "2", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  const f = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
  const n = f.length / 2, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1]; }
  return { L, R, n };
}

// ---------- the edit ----------
await ensureTrack();
const grid = analyze(TRACK.file);
const srcBar = (n) => grid.firstDownbeat + n * 4 * grid.beat;
console.log(`track: ${grid.bpm} BPM, beat ${grid.beat} s, first downbeat ${grid.firstDownbeat} s, ${grid.fit.hits} attacks fitted (rms ${grid.fit.rmsMs} ms)`);
const src = decodeStereo(TRACK.file);
const L = new Float32Array(N), R = new Float32Array(N);
// Each segment starts PRE before its bar line and crosses over XF, so every cut lands just ahead of the attack.
const PRE = 0.006, XF = 0.004;
EDIT.forEach((seg, k) => {
  const r0 = seg.reel * BAR, r1 = (seg.reel + seg.bars) * BAR;
  const off = srcBar(seg.src) - r0; // source time = reel time + off
  const a = k === 0 ? 0 : r0 - PRE - XF / 2, z = k === EDIT.length - 1 ? DUR : r1 - PRE + XF / 2;
  const lift = seg.gainDb || 0, liftEnd = r0 + (seg.gainBars || 0) * BAR;
  for (let i = at(a); i < Math.min(N, at(z)); i++) {
    const t = i / SR;
    let w = 1;
    if (k > 0 && t < r0 - PRE + XF / 2) w = Math.sin((Math.PI / 2) * ((t - a) / XF));
    if (k < EDIT.length - 1 && t > r1 - PRE - XF / 2) w = Math.cos((Math.PI / 2) * ((t - (r1 - PRE - XF / 2)) / XF));
    // the hook's lift falls away over the last 30 ms before the drop's attack
    const g = lift && t < liftEnd ? dbg(lift * Math.min(1, Math.max(0, (liftEnd - 0.008 - t) / 0.03))) : 1;
    const j = Math.round((t + off) * SR);
    if (j < 0 || j >= src.n) continue;
    L[i] += src.L[j] * w * g;
    R[i] += src.R[j] * w * g;
  }
});
for (let i = 0; i < at(0.002); i++) { const g = i / at(0.002); L[i] *= g; R[i] *= g; }
for (let i = N - at(0.05); i < N; i++) { const g = (N - i) / at(0.05); L[i] *= g; R[i] *= g; }

// ---------- UI sounds: typing, ticks, whooshes and hits from the scenes' own cues (audio/sfx.mjs) ----------
const SHEET = JSON.parse(await readFile(join(HERE, `cues${SFX}.json`), "utf8"));
const fx = renderSfx(SHEET.cues, N, SR);
const FX_DB = +(process.env.FX_DB ?? -4), VERB_DB = FX_DB - 2;
const music = { L: L.slice(), R: R.slice() };
for (let i = 0; i < N; i++) {
  L[i] += fx.dry.L[i] * dbg(FX_DB) + fx.wet.L[i] * dbg(VERB_DB);
  R[i] += fx.dry.R[i] * dbg(FX_DB) + fx.wet.R[i] * dbg(VERB_DB);
}
// how loud each cue sits against the music around it (RMS over 60 ms from the cue), median and range
{
  const w = at(0.06), rel = [];
  for (const c of SHEET.cues) {
    let m = 0, f = 0;
    for (let i = at(c.t); i < Math.min(N, at(c.t) + w); i++) {
      m += music.L[i] ** 2 + music.R[i] ** 2;
      const a = fx.dry.L[i] * dbg(FX_DB) + fx.wet.L[i] * dbg(VERB_DB), z = fx.dry.R[i] * dbg(FX_DB) + fx.wet.R[i] * dbg(VERB_DB);
      f += a * a + z * z;
    }
    rel.push({ kind: c.kind, db: 10 * Math.log10((f + 1e-12) / (m + 1e-12)) });
  }
  const by = {};
  rel.forEach((r) => (by[r.kind] ||= []).push(r.db));
  console.log(`sfx: ${SHEET.cues.length} cues at ${FX_DB} dB; level against the music, by kind: ` + Object.entries(by).map(([k, v]) => `${k} ${(v.reduce((s, x) => s + x, 0) / v.length).toFixed(1)}`).join(", "));
}

// ---------- master: gain to the loudness target, then a look-ahead limiter under the true-peak ceiling ----------
function knee(y, ceil) {
  const k = 0.8 * ceil, a = Math.abs(y);
  return a <= k ? y : Math.sign(y) * (k + (ceil - k) * Math.tanh((a - k) / (ceil - k)));
}
function limit(inL, inR, gain, ceilDb) {
  const ceil = dbg(ceilDb), look = at(0.004), rel = Math.exp(-1 / (0.08 * SR));
  const oL = new Float32Array(N), oR = new Float32Array(N), need = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.max(Math.abs(inL[i]), Math.abs(inR[i])) * gain;
    const b2 = i + 1 < N ? Math.max(Math.abs(inL[i + 1]), Math.abs(inR[i + 1])) * gain : a;
    const pk = Math.max(a, b2, Math.abs((inL[i] + (inL[i + 1] ?? 0)) / 2) * gain * 1.1, Math.abs((inR[i] + (inR[i + 1] ?? 0)) / 2) * gain * 1.1);
    need[i] = pk > ceil ? ceil / pk : 1;
  }
  let g = 1;
  const win = [];
  for (let i = 0; i < N; i++) {
    const j = i + look, nj = j < N ? need[j] : 1;
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
export function loudness(file) {
  const p = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const s = p.stderr.slice(p.stderr.lastIndexOf("Summary:"));
  return { I: +s.match(/I:\s+(-?[\d.]+) LUFS/)[1], TP: +s.match(/Peak:\s+(-?[\d.inf]+) dBFS/)[1], LRA: +s.match(/LRA:\s+(-?[\d.]+) LU/)[1] };
}

const OUTDIR = join(HERE, "out");
await mkdir(OUTDIR, { recursive: true });
const file = join(OUTDIR, `soundtrack${SFX}.wav`);
let gainDb = 0, ceilDb = -1.5, m;
for (let pass = 1; pass <= 8; pass++) {
  const [oL, oR] = limit(L, R, dbg(gainDb), ceilDb);
  await writeFile(file, wav(oL, oR));
  m = loudness(file);
  console.log(`pass ${pass}: gain ${gainDb.toFixed(2)} dB, ceiling ${ceilDb.toFixed(2)} dBFS -> ${m.I.toFixed(2)} LUFS, true peak ${m.TP.toFixed(2)} dBTP, LRA ${m.LRA} LU`);
  const okI = Math.abs(m.I - TARGET_LUFS) <= 0.3, okTP = m.TP <= TP_MAX;
  if (okI && okTP) break;
  if (!okTP) ceilDb -= m.TP - TP_MAX + 0.15;
  gainDb += TARGET_LUFS - m.I;
}
if (Math.abs(m.I - TARGET_LUFS) > 0.3 || m.TP > TP_MAX) { console.error("could not reach the loudness target"); process.exit(1); }
console.log(`wrote ${file}: ${DUR} s, 48 kHz stereo, ${m.I.toFixed(1)} LUFS integrated, ${m.TP.toFixed(1)} dBTP`);
