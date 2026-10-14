// Where the soundtrack's big attacks land against the reel's beat grid: the drop (the end of the first segment's lift) and
// the start of every later segment of the EDIT. `verify` folds the mix onto the beat phase it hears, which a short edit with
// many UI sounds can read half a beat off; this measures the music's own seams instead. The biggest 4 ms level rise within
// ±100 ms of each seam is the attack; its offset from the seam is the error (ms; the mix places each cut 6 ms ahead of its bar line).
//   node audio/seams.mjs [--cut saas]      reads audio/out/soundtrack[-cut].wav
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const cutAt = process.argv.indexOf("--cut");
const CUT = cutAt < 0 ? "media" : process.argv[cutAt + 1];
const SFX = CUT === "media" ? "" : `-${CUT}`;
const { EDIT, BAR } = await import(CUT === "media" ? "../timeline.js" : `../${CUT}/timeline.js`);
const SR = 48000;
const r = spawnSync("ffmpeg", ["-v", "error", "-i", join(HERE, "out", `soundtrack${SFX}.wav`), "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
if (r.status !== 0) throw new Error(`no soundtrack: run node audio/mix.mjs${CUT === "media" ? "" : ` --cut ${CUT}`} first`);
const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
const level = (a, b) => {
  let e = 0, n = 0;
  for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) { e += x[i] * x[i]; n++; }
  return 10 * Math.log10(e / n + 1e-12);
};
const seams = [{ what: "the drop", t: EDIT[0].gainBars * BAR }, ...EDIT.slice(1).map((s) => ({ what: `bar ${s.reel}`, t: s.reel * BAR }))];
for (const s of seams) {
  let best = { d: -Infinity, t: s.t };
  for (let t = s.t - 0.1; t < s.t + 0.1; t += 0.001) {
    const d = level(t + 0.002, t + 0.006) - level(t - 0.004, t);
    if (d > best.d) best = { d, t: t + 0.002 };
  }
  console.log(`${s.what.padEnd(8)} seam ${s.t.toFixed(3)} s: attack at ${best.t.toFixed(3)} s, ${((best.t - s.t) * 1000).toFixed(1)} ms off, +${best.d.toFixed(1)} dB`);
}
