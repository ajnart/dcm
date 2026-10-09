// Deterministic frame renderer: every pixel is a pure function of t (window.seek).
//   node render.mjs stills 0:25:1          PNG stills (list "1,2.5" or range start:end:step) → out/stills/
//   node render.mjs lint [times]           determinism (same t twice, out of order, fresh page) + safe-area text check
//   node render.mjs video [--sub 8] [--workers 6] [--fps 60] [--crf 23] [--fresh]   (chunks resume; --crf only re-muxes)
//   node render.mjs contact                25-frame contact sheet from the final MP4
//   node render.mjs eval "<js>" <t>        evaluate an expression at t
import { chromium } from "playwright";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, readdir, mkdir, writeFile, rm, access, rename } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";
import { createHash } from "node:crypto";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "out");
const DUR = 25;
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

async function stills(url, times) {
  const dir = join(OUT, flag("dir", "stills"));
  await mkdir(dir, { recursive: true });
  const browser = await chromium.launch(LAUNCH);
  const { page, cdp } = await openPage(browser, url);
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
  for (const t of times) {
    await a.page.evaluate((x) => window.seek(x), t);
    seen.set(t, await shot(a.cdp));
    const issues = await a.page.evaluate(() => window.lint());
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
  console.log(bad ? `lint: ${bad} problem(s)` : `lint: ok — ${times.length} times revisited out of order and on a fresh page; ${differing} frame(s) carried sub-pixel glyph raster noise (worst ${minPsnr.toFixed(1)} dB PSNR, 30 dB is the failure line); no text outside the safe area`);
  if (bad) process.exitCode = 1;
}

async function sourceHash() {
  const hash = createHash("sha1");
  const walk = async (d) => {
    for (const e of (await readdir(d, { withFileTypes: true })).sort((x, y) => x.name.localeCompare(y.name))) {
      if (e.name === "node_modules" || e.name === "out" || e.name === "render.mjs") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(js|mjs|css|html|svg)$/.test(e.name)) { hash.update(p); hash.update(await readFile(p)); }
    }
  };
  await walk(ROOT);
  return hash.digest("hex").slice(0, 10);
}

async function video(url, { fps, sub, workers, chunk, fresh, out, crf }) {
  const total = Math.round(DUR * fps);
  const dir = join(OUT, `chunks-${await sourceHash()}-${fps}-${sub}`);
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
              const t = Math.min(DUR - 1e-4, Math.max(0, (k + ((j + 0.5) / sub - 0.5) * SHUTTER) / fps));
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
  const ff = ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-tune", "film", "-pix_fmt", "yuv420p", "-r", String(fps), "-frames:v", String(total), "-movflags", "+faststart", "-an", join(OUT, out)]);
  ff.stdin.end();
  await ff.done;
  console.log("wrote", join(OUT, out), `in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

async function contact() {
  const src = join(OUT, "selfhost-reel.mp4");
  const font = join(ROOT, "node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff");
  const vf = "select='eq(mod(n\\,60)\\,30)',scale=384:216:flags=lanczos,tile=5x5:margin=0:padding=0";
  const ff = ffmpeg(["-i", src, "-vf", vf, "-frames:v", "1", join(OUT, "contact.png")]);
  ff.stdin.end();
  await ff.done;
  console.log("wrote", join(OUT, "contact.png"), font ? "" : "");
}

const srv = await serve();
const url = `http://127.0.0.1:${srv.address().port}/index.html`;
try {
  if (mode === "stills") await stills(url, parseTimes(args[1]));
  else if (mode === "lint") await lint(url, parseTimes(args[1] || "0.25:24.75:0.5"));
  else if (mode === "contact") await contact();
  else if (mode === "eval") {
    const browser = await chromium.launch(LAUNCH);
    const { page } = await openPage(browser, url);
    await page.evaluate((x) => window.seek(x), +args[2]);
    console.log(JSON.stringify(await page.evaluate(args[1]), null, 1));
    await browser.close();
  } else if (mode === "video") await video(url, { fps: +flag("fps", 60), sub: +flag("sub", 8), workers: +flag("workers", Math.max(2, Math.min(8, Math.floor(cpus().length / 2)))), chunk: +flag("chunk", 60), fresh: has("fresh"), out: flag("out", "selfhost-reel.mp4"), crf: +flag("crf", 23) });
  else console.log("usage: node render.mjs stills|lint|video|contact|eval");
} finally {
  srv.close();
}
