// Deterministic frame renderer: every pixel is a pure function of t (window.seek).
//   node render.mjs stills 0:52:0.5        PNG stills (list "1,2.5", range start:end:step, or "holds") → out/stills/
//   node render.mjs lint [times]           readability holds + undeclared text + safe area + determinism
//   node render.mjs cues                   write the cue sheet (picture cuts, sound cues, the edit) → audio/cues.json
//   node render.mjs video [--sub 8] [--workers 6] [--fps 60] [--crf 23] [--fresh]   (chunks resume; --crf only re-muxes)
//   node render.mjs contact                one frame per second from the final MP4, in a grid
//   node render.mjs verify                 streams, loudness, flash scan and beat sync of the final MP4
//   node render.mjs sheets [dir] [prefix]  4×3 review sheets of out/<dir>/*.png → out/sheets/
//   node render.mjs eval "<js>" <t>        evaluate an expression at t
import { chromium } from "playwright";
import { DUR } from "./timeline.js";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, readdir, mkdir, writeFile, rm, access, rename } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";
import { createHash } from "node:crypto";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "out");
const AUDIO = join(ROOT, "audio");
const SHUTTER = 0.5;
const args = process.argv.slice(2);
const mode = args[0];
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json" };
function serve() {
  return new Promise((res) => {
    const srv = createServer(async (req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p === "/") p = "/index.html";
      try {
        const body = await readFile(join(ROOT, p));
        rsp.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
        rsp.end(body);
      } catch {
        rsp.writeHead(404);
        rsp.end();
      }
    });
    srv.listen(0, "127.0.0.1", () => res(srv));
  });
}

const LAUNCH = {
  args: [
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-compositing",
    "--font-render-hinting=none", "--force-color-profile=srgb", "--hide-scrollbars",
    "--disable-lcd-text", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion", "--run-all-compositor-stages-before-draw",
  ],
};

async function openPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error(`[console.${m.type()}]`, m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const cdp = await page.context().newCDPSession(page);
  return { page, cdp };
}

async function shot(cdp) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, captureBeyondViewport: false });
  return Buffer.from(data, "base64");
}

function ffmpeg(argv) {
  const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...argv], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => p.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  p.stdin.on("error", () => {});
  return { stdin: p.stdin, done };
}
const write = (stream, buf) => new Promise((res) => { if (stream.write(buf)) res(); else stream.once("drain", res); });

function parseTimes(spec) {
  if (spec.includes(":")) {
    const [a, b, s] = spec.split(":").map(Number);
    const out = [];
    for (let t = a; t <= b + 1e-9; t += s) out.push(+t.toFixed(4));
    return out;
  }
  return spec.split(",").map(Number);
}

async function stills(url, spec) {
  const dir = join(OUT, flag("dir", "stills"));
  await mkdir(dir, { recursive: true });
  const browser = await chromium.launch(LAUNCH);
  const { page, cdp } = await openPage(browser, url);
  // "holds": the first and last frame of every declared readability hold
  const times = spec === "holds"
    ? [...new Set((await page.evaluate(() => window.lintHolds())).flatMap((h) => [h.a, h.b - 0.01]).map((t) => +t.toFixed(2)))].sort((x, y) => x - y)
    : parseTimes(spec);
  for (const t of times) {
    await page.evaluate((x) => window.seek(x), t);
    const file = join(dir, `t${t.toFixed(2).padStart(5, "0")}.png`);
    await writeFile(file, await shot(cdp));
    console.log(file);
  }
  await browser.close();
}

async function lint(url, times) {
  const browser = await chromium.launch(LAUNCH);
  const a = await openPage(browser, url);
  const judge = await browser.newPage();
  const diff = (x, y) => judge.evaluate(async ([p, q]) => {
    const load = async (b64) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, bmp.width, bmp.height).data;
    };
    const [d1, d2] = [await load(p), await load(q)];
    let max = 0, count = 0, sq = 0;
    for (let i = 0; i < d1.length; i += 4) {
      const e0 = d1[i] - d2[i], e1 = d1[i + 1] - d2[i + 1], e2 = d1[i + 2] - d2[i + 2];
      const m = Math.max(Math.abs(e0), Math.abs(e1), Math.abs(e2));
      sq += e0 * e0 + e1 * e1 + e2 * e2;
      if (m > 0) count++;
      if (m > max) max = m;
    }
    const mse = sq / (d1.length / 4 * 3);
    return { max, count, psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse) };
  }, [x.toString("base64"), y.toString("base64")]);
  const seen = new Map();
  let bad = 0, worst = 0, differing = 0, minPsnr = Infinity;

  // 0 · the beat: every beat up to the end card's still hold has a declared event and visibly changes the frame;
  //     every cut, sound cue and event sits on the 0.5 s grid
  const changed = (x, y) => judge.evaluate(async ([p, q]) => {
    const load = async (b64) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, bmp.width, bmp.height).data;
    };
    const [d1, d2] = [await load(p), await load(q)];
    let n = 0;
    for (let i = 0; i < d1.length; i += 4) if (Math.max(Math.abs(d1[i] - d2[i]), Math.abs(d1[i + 1] - d2[i + 1]), Math.abs(d1[i + 2] - d2[i + 2])) > 24) n++;
    return n / (d1.length / 4);
  }, [x.toString("base64"), y.toString("base64")]);
  const bt = await a.page.evaluate(() => window.lintBeats());
  for (const e of bt.empty) { bad++; console.log("DEAD BEAT (no event)", JSON.stringify(e)); }
  for (const e of bt.offGrid) { bad++; console.log("OFF THE BEAT", JSON.stringify(e)); }
  let quietest = { f: 1 };
  for (const x of bt.beats) {
    await a.page.evaluate((t) => window.seek(t), Math.max(0, x.t - 0.03));
    const before = await shot(a.cdp);
    await a.page.evaluate((t) => window.seek(t), x.t + 0.2);
    const f = await changed(before, await shot(a.cdp));
    if (f < quietest.f) quietest = { f, t: x.t, what: x.what.join("; ") };
    if (f < 0.002) { bad++; console.log("DEAD BEAT (frame barely changes)", JSON.stringify({ t: x.t, changed: +(f * 100).toFixed(3) + "%", what: x.what })); }
  }
  console.log(`beats: ${bt.beats.length} beats to ${bt.settled} s, ${bt.empty.length} without an event, ${bt.offGrid.length} off the grid; smallest change ${(quietest.f * 100).toFixed(2)}% of pixels at ${quietest.t} s (${quietest.what})`);

  // 1 · readability: every declared hold is long enough (1-3 words: 0.4 s; otherwise 0.4 s + 0.25 s/word), 32 px+, opaque, unoverlapped and still
  const rd = await a.page.evaluate(() => window.lintRead());
  for (const i of rd.issues) { bad++; console.log("READABILITY", JSON.stringify(i)); }
  const tight = rd.holds.reduce((m, h) => Math.min(m, h.have - h.need), Infinity);
  console.log(`readability: ${rd.holds.length} holds checked at 30 Hz, ${rd.issues.length} problem(s); tightest margin ${tight.toFixed(2)} s`);
  // 2 · every visible text is declared readable or [data-deco]
  let undeclared = 0;
  for (let t = 0.1; t < DUR; t += 0.25) {
    const u = await a.page.evaluate((x) => window.lintUndeclared(x), +t.toFixed(3));
    for (const i of u) { if (undeclared++ < 40) console.log("UNDECLARED TEXT", JSON.stringify(i)); }
  }
  if (undeclared) { bad++; console.log(`undeclared text: ${undeclared} sighting(s)`); }

  for (const t of times) {
    await a.page.evaluate((x) => window.seek(x), t);
    seen.set(t, await shot(a.cdp));
    const issues = await a.page.evaluate((x) => window.lint(x), t);
    if (issues.length) { bad++; console.log(`safe-area ${t.toFixed(2)}`, JSON.stringify(issues)); }
  }
  const check = async (label, t, buf) => {
    const d = await diff(seen.get(t), buf);
    if (d.count) {
      differing++; worst = Math.max(worst, d.max); minPsnr = Math.min(minPsnr, d.psnr);
      // sub-pixel glyph placement noise is ~35-65 dB (thin glyph edges only); a real state leak (wrong element, wrong state) lands far below 30 dB
      if (d.psnr < 30) { bad++; console.log(`NON-DETERMINISTIC (${label}) t=${t} psnr=${d.psnr.toFixed(1)}dB maxΔ=${d.max} px=${d.count}`); }
    }
  };
  const order = [...times].sort((x, y) => ((x * 7919) % 13) - ((y * 7919) % 13));
  for (const t of order) {
    await a.page.evaluate((x) => window.seek(x), (t + 9.37) % DUR);
    await a.page.evaluate((x) => window.seek(x), t);
    await check("out-of-order", t, await shot(a.cdp));
  }
  const b = await openPage(browser, url);
  for (const t of times.filter((_, i) => i % 3 === 0)) {
    await b.page.evaluate((x) => window.seek(x), t);
    await check("fresh page", t, await shot(b.cdp));
  }
  await browser.close();
  console.log(bad ? `lint: ${bad} problem(s)` : `lint: ok — something happens on every beat and every cut is on the grid; every readable text holds long enough, legible and still; no undeclared text; ${times.length} times revisited out of order and on a fresh page; ${differing} frame(s) carried sub-pixel glyph raster noise (worst ${minPsnr.toFixed(1)} dB PSNR, 30 dB is the failure line); no text outside the safe area`);
  if (bad) process.exitCode = 1;
}

async function sourceHash() {
  const hash = createHash("sha1");
  const walk = async (d) => {
    for (const e of (await readdir(d, { withFileTypes: true })).sort((x, y) => x.name.localeCompare(y.name))) {
      if (e.name === "node_modules" || e.name === "out" || e.name === "audio" || e.name === "render.mjs") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(js|mjs|css|html|svg|png)$/.test(e.name)) { hash.update(p); hash.update(await readFile(p)); }
    }
  };
  await walk(ROOT);
  return hash.digest("hex").slice(0, 10);
}

async function video(url, { fps, sub, workers, chunk, fresh, out, crf }) {
  const total = Math.round(DUR * fps);
  const dir = join(OUT, `chunks-${await sourceHash()}-${fps}-${sub}-open`);
  if (fresh) await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const jobs = [];
  for (let s = 0; s < total; s += chunk) jobs.push({ s, e: Math.min(total, s + chunk), file: join(dir, `c${String(s).padStart(5, "0")}.mkv`) });
  const todo = [];
  for (const j of jobs) { try { await access(j.file); } catch { todo.push(j); } }
  console.log(`${jobs.length} chunks, ${todo.length} to render, ${workers} workers, ${sub} sub-frames`);
  const t0 = Date.now();
  let doneFrames = 0;
  const todoFrames = todo.reduce((a, j) => a + j.e - j.s, 0);

  async function worker(id) {
    let browser = await chromium.launch(LAUNCH);
    let ctx = await openPage(browser, url);
    let used = 0;
    while (todo.length) {
      const job = todo.shift();
      for (let attempt = 0; ; attempt++) {
        try {
          if (used++ >= 5 || attempt > 0) {
            await browser.close().catch(() => {});
            browser = await chromium.launch(LAUNCH);
            ctx = await openPage(browser, url);
            used = 1;
          }
          const tmp = job.file.replace(".mkv", ".part.mkv");
          const vf = sub > 1 ? [`tmix=frames=${sub}`, `select='eq(mod(n\\,${sub})\\,${sub - 1})'`, `setpts=N/(${fps}*TB)`] : [];
          const ff = ffmpeg(["-f", "image2pipe", "-framerate", String(fps * sub), "-c:v", "png", "-i", "-", ...(vf.length ? ["-vf", vf.join(",")] : []), "-r", String(fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "6", "-pix_fmt", "yuv444p", "-f", "matroska", tmp]);
          for (let k = job.s; k < job.e; k++) {
            for (let j = 0; j < sub; j++) {
              // the shutter opens at the frame's own time, so the frame on a hard cut shows only the new shot
              const t = Math.min(DUR - 1e-4, (k + ((j + 0.5) / sub) * SHUTTER) / fps);
              await ctx.page.evaluate((x) => window.seek(x), t);
              await write(ff.stdin, await shot(ctx.cdp));
            }
            doneFrames++;
          }
          ff.stdin.end();
          await ff.done;
          await rename(tmp, job.file);
          break;
        } catch (err) {
          console.error(`[w${id}] chunk ${job.s} failed (${err.message}); retrying`);
          if (attempt >= 2) throw err;
        }
      }
      const el = (Date.now() - t0) / 1000;
      console.log(`[w${id}] chunk ${job.s}-${job.e} · ${doneFrames}/${todoFrames} frames · ${(doneFrames / el).toFixed(2)} fps · eta ${((todoFrames - doneFrames) / (doneFrames / el)).toFixed(0)}s`);
    }
    await browser.close();
  }
  await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));

  const list = join(dir, "list.txt");
  await writeFile(list, jobs.map((j) => `file '${j.file}'`).join("\n"));
  const wav = join(AUDIO, "out", "soundtrack.wav");
  await access(wav).catch(() => { throw new Error(`no soundtrack at ${wav}: run node render.mjs cues && node audio/mix.mjs first`); });
  const ff = ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-i", wav, "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-tune", "film", "-pix_fmt", "yuv420p", "-r", String(fps), "-frames:v", String(total),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", String(DUR), "-movflags", "+faststart", join(OUT, out)]);
  ff.stdin.end();
  await ff.done;
  console.log("wrote", join(OUT, out), `in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

// Checks on the final MP4: both streams and their durations, loudness, a frame-by-frame luminance scan
// for flashes, and how far each picture cut lies from the beat grid detected in the file's own audio.
async function verify(file) {
  const { spawnSync } = await import("node:child_process");
  const run = (cmd, argv, opts = {}) => spawnSync(cmd, argv, { maxBuffer: 1 << 30, ...opts });
  const probe = JSON.parse(run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }).stdout);
  const v = probe.streams.find((s) => s.codec_type === "video"), au = probe.streams.find((s) => s.codec_type === "audio");
  const streams = { video: v && { codec: v.codec_name, profile: v.profile, pix_fmt: v.pix_fmt, size: `${v.width}x${v.height}`, fps: v.r_frame_rate, frames: +v.nb_frames, duration: +v.duration }, audio: au && { codec: au.codec_name, rate: +au.sample_rate, channels: au.channels, kbps: Math.round(au.bit_rate / 1000), duration: +au.duration }, container: +probe.format.duration, mb: +(probe.format.size / 1e6).toFixed(2) };
  const head = (await readFile(file)).subarray(0, 4096);
  streams.faststart = head.indexOf("moov") >= 0 && (head.indexOf("mdat") < 0 || head.indexOf("moov") < head.indexOf("mdat"));
  const e = run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-map", "0:a", "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const sum = e.slice(e.lastIndexOf("Summary:"));
  const loud = { I: +sum.match(/I:\s+(-?[\d.]+) LUFS/)[1], LRA: +sum.match(/LRA:\s+(-?[\d.]+) LU/)[1], TP: +sum.match(/Peak:\s+(-?[\d.inf]+) dBFS/)[1] };
  // mean luma per frame (Rec. 709 weights on a 192x108 copy), then flashes: a pair of opposing changes of
  // 20+ levels within 0.5 s; more than three such pairs in any second would fail
  const W = 192, H = 108;
  const raw = run("ffmpeg", ["-v", "error", "-i", file, "-vf", `scale=${W}:${H}:flags=area`, "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]).stdout;
  const luma = [];
  for (let f = 0; f * W * H * 3 < raw.length; f++) {
    let s = 0;
    for (let i = f * W * H * 3; i < (f + 1) * W * H * 3; i += 3) s += 0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2];
    luma.push(s / (W * H));
  }
  const fps = 60;
  let maxJump = { d: 0 };
  const changes = [];
  for (let f = 1; f < luma.length; f++) {
    const d = luma[f] - luma[f - 1];
    if (Math.abs(d) > Math.abs(maxJump.d)) maxJump = { d: +d.toFixed(1), t: +(f / fps).toFixed(3), from: +luma[f - 1].toFixed(1), to: +luma[f].toFixed(1) };
  }
  // collapse each monotonic run into one change, keep the ones of 20+ levels
  let a = 0;
  for (let f = 1; f <= luma.length; f++) {
    const dir = f < luma.length ? Math.sign(luma[f] - luma[f - 1]) : 0;
    const prev = Math.sign(luma[f - 1] - luma[Math.max(0, f - 2)]);
    if (f === luma.length || (dir !== prev && f - 1 > a)) {
      const d = luma[f - 1] - luma[a];
      if (Math.abs(d) >= 20) changes.push({ t0: a / fps, t1: (f - 1) / fps, d });
      a = f - 1;
    }
  }
  const flashes = [];
  for (let i = 1; i < changes.length; i++) if (Math.sign(changes[i].d) !== Math.sign(changes[i - 1].d) && changes[i].t1 - changes[i - 1].t0 <= 0.5) flashes.push(+changes[i - 1].t0.toFixed(2));
  const perSecond = Math.max(0, ...flashes.map((t) => flashes.filter((u) => u >= t && u < t + 1).length));
  const lum = { frames: luma.length, mean: +(luma.reduce((s, x) => s + x, 0) / luma.length).toFixed(1), max: +Math.max(...luma).toFixed(1), maxFrameJump: maxJump, changesOver20: changes.length, flashes, maxFlashesPerSecond: perSecond };
  const { analyze, offsets } = await import("./audio/analyze.mjs");
  const g = analyze(file);
  const sheet = JSON.parse(await readFile(join(AUDIO, "cues.json"), "utf8"));
  const off = offsets(sheet.cuts.map((c) => c.t), g.firstBeat, g.beat);
  let worst = 0, wi = 0;
  off.forEach((o, i) => { if (Math.abs(o) > Math.abs(worst)) { worst = o; wi = i; } });
  const beat = { detected: { bpm: g.bpm, beat: g.beat, firstBeat: g.firstBeat, fit: g.fit }, cuts: off.length, worstMs: +worst.toFixed(2), worstAt: sheet.cuts[wi], meanAbsMs: +(off.reduce((s, o) => s + Math.abs(o), 0) / off.length).toFixed(2) };
  console.log(JSON.stringify({ streams, loudness: loud, luminance: lum, beatSync: beat }, null, 1));
}

// lay PNGs out in a labelled grid with the browser (this ffmpeg build has no drawtext)
async function grid(files, labels, out, { cols, w, h }) {
  const browser = await chromium.launch(LAUNCH);
  const rows = Math.ceil(files.length / cols);
  const page = await browser.newPage({ viewport: { width: cols * w, height: rows * h }, deviceScaleFactor: 1 });
  const cells = await Promise.all(files.map(async (f, i) => `<div style="position:relative;width:${w}px;height:${h}px;background:url(data:image/png;base64,${(await readFile(f)).toString("base64")}) 0 0/${w}px ${h}px"><b style="position:absolute;left:4px;top:3px;font:600 ${Math.round(h / 8)}px monospace;color:#fff;background:#000b;padding:0 4px">${labels[i]}</b></div>`));
  await page.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${w}px)">${cells.join("")}</body>`);
  await page.screenshot({ path: out });
  await browser.close();
}

async function contact() {
  const src = join(OUT, "selfhost-reel.mp4");
  const dir = join(OUT, "contact-frames");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const ff = ffmpeg(["-i", src, "-vf", "select='eq(mod(n\\,60)\\,30)',scale=240:135:flags=lanczos", "-fps_mode", "vfr", join(dir, "f%03d.png")]);
  ff.stdin.end();
  await ff.done;
  const files = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort().map((f) => join(dir, f));
  await grid(files, files.map((_, i) => `${i}.5 s`), join(OUT, "contact.png"), { cols: 8, w: 240, h: 135 });
  console.log("wrote", join(OUT, "contact.png"), `(${files.length} frames, one per second)`);
}

async function sheets(dir, prefix = "s") {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
  const outDir = join(OUT, "sheets");
  await mkdir(outDir, { recursive: true });
  for (let i = 0, k = 0; i < files.length; i += 12, k++) {
    const part = files.slice(i, i + 12);
    await grid(part.map((f) => join(dir, f)), part.map((f) => f.replace(".png", "")), join(outDir, `${prefix}${String(k).padStart(2, "0")}.png`), { cols: 4, w: 480, h: 270 });
  }
  console.log(`wrote ${Math.ceil(files.length / 12)} sheet(s) to ${outDir}`);
}

const srv = await serve();
const url = `http://127.0.0.1:${srv.address().port}/index.html`;
try {
  if (mode === "stills") await stills(url, args[1]);
  else if (mode === "lint") await lint(url, parseTimes(args[1] || `0.25:${DUR - 0.25}:0.5`));
  else if (mode === "cues") {
    const browser = await chromium.launch(LAUNCH);
    const { page } = await openPage(browser, url);
    const sheet = await page.evaluate(() => window.cueSheet());
    await mkdir(AUDIO, { recursive: true });
    await writeFile(join(AUDIO, "cues.json"), JSON.stringify(sheet, null, 1) + "\n");
    console.log(`wrote ${join(AUDIO, "cues.json")}: ${sheet.cues.length} cues over ${sheet.duration} s`);
    await browser.close();
  }
  else if (mode === "contact") await contact();
  else if (mode === "verify") await verify(join(OUT, args[1] || "selfhost-reel.mp4"));
  else if (mode === "sheets") await sheets(join(OUT, args[1] || "stills"), args[2]);
  else if (mode === "eval") {
    const browser = await chromium.launch(LAUNCH);
    const { page } = await openPage(browser, url);
    await page.evaluate((x) => window.seek(x), +(args[2] || 0));
    console.log(JSON.stringify(await page.evaluate(args[1]), null, 1));
    await browser.close();
  } else if (mode === "video") await video(url, { fps: +flag("fps", 60), sub: +flag("sub", 8), workers: +flag("workers", Math.max(2, Math.min(8, Math.floor(cpus().length / 2)))), chunk: +flag("chunk", 60), fresh: has("fresh"), out: flag("out", "selfhost-reel.mp4"), crf: +flag("crf", 23) });
  else console.log("usage: node render.mjs stills|lint|cues|video|contact|eval");
} finally {
  srv.close();
}
