import { gsap, $, $$, proc, prog, clamp, scene, icon, read, cue } from "./lib.js";
import { SC } from "./timeline.js";

// Each rented service and the Catalog App that replaces it (self-host apps list --json):
// jellyfin "Streams your movies, shows and music to every screen", navidrome "Streams your own music library",
// nextcloud "Keeps your files, calendars and contacts in sync" (the files Recipe replaces Drive and Dropbox),
// syncthing "Keeps folders in sync between your own devices", immich "Private photo and video backup",
// vaultwarden "Password manager compatible with the Bitwarden apps", docmost "Collaborative wiki and
// documentation workspace", open-webui "Private chat interface for your own language models".
export const TILES = [
  { id: "netflix", name: "Netflix", price: 15, rep: "jellyfin", repName: "Jellyfin", from: [210, 214, 0.74, -13], wall: [0, 0] },
  { id: "spotify", name: "Spotify", price: 12, rep: "navidrome", repName: "Navidrome", from: [1708, 168, 0.62, 12], wall: [1, 0] },
  { id: "google-drive", name: "Drive", price: 10, rep: "nextcloud", repName: "Nextcloud", from: [128, 650, 0.86, 9], wall: [2, 0] },
  { id: "dropbox", name: "Dropbox", price: 12, rep: "syncthing", repName: "Syncthing", from: [1800, 586, 0.7, -10], wall: [3, 0] },
  { id: "google-photos", name: "Photos", price: 10, rep: "immich", repName: "Immich", from: [452, 948, 0.62, 16], wall: [0, 1] },
  { id: "1password", name: "1Password", price: 3, rep: "vaultwarden", repName: "Vaultwarden", from: [1500, 930, 0.8, -12], wall: [1, 1] },
  { id: "notion", name: "Notion", price: 10, rep: "docmost", repExt: "png", repName: "Docmost", from: [690, 132, 0.5, 8], wall: [2, 1] },
  { id: "chatgpt", name: "ChatGPT", price: 20, rep: "open-webui", repName: "Open WebUI", from: [1236, 140, 0.55, -9], wall: [3, 1] },
];
const TOTAL = TILES.reduce((s, x) => s + x.price, 0);

const LOCK = `<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9.5" rx="2.4"/><path class="sh" d="M8 11V7.6a4 4 0 0 1 8 0V11"/></svg>`;
const [A, B] = SC.hook;
const T = { enter: 0.04, words: 0.15, hookOut: 3.05, wallIn: 3.0, head: 3.35, locks: 3.85, headOut: 5.3, flip: 5.35, yours: 5.6, out: 8.66 };
export const WALL = (tile) => [960 + (tile.wall[0] - 1.5) * 322, 684 + (tile.wall[1] - 0.5) * 322];

export function build(tl) {
  scene("hook", A, B);
  const layer = $("#tiles");
  const nodes = TILES.map((tile) => {
    const el = document.createElement("div");
    el.className = "tile";
    el.innerHTML = `<div class="drift"><div class="flip">
      <div class="face front"><img src="${icon(tile.id)}"><div class="nm">${tile.name}</div><div class="price">$${tile.price}/mo</div><div class="lock">${LOCK}</div></div>
      <div class="face back"><div class="was"><img src="${icon(tile.id)}"></div><img src="${icon(tile.rep, tile.repExt)}"><div class="nm">${tile.repName}</div><div class="price">yours</div></div>
    </div></div>`;
    layer.appendChild(el);
    return { tile, el, drift: $(".drift", el), flip: $(".flip", el), lock: $(".lock", el) };
  });

  const glow = $("#hook-glow");
  tl.fromTo(glow, { x: 1500, y: 300, scale: 0.8 }, { x: 460, y: 620, scale: 1.1, duration: 3, ease: "power2.out" }, 0);
  tl.fromTo(glow, { x: 460, y: 620, scale: 1.1 }, { x: 960, y: 640, scale: 1.6, duration: 2.0, ease: "power2.inOut" }, 3);

  nodes.forEach((n, i) => {
    const [fx, fy, fs, fr] = n.tile.from;
    const dx = fx - 960, dy = fy - 540;
    const len = Math.hypot(dx, dy);
    const sx = fx + (dx / len) * 1500, sy = fy + (dy / len) * 1500;
    const [wx, wy] = WALL(n.tile);
    const blur = fs > 0.78 ? 6 : fs < 0.58 ? 3 : 0;
    gsap.set(n.el, { filter: blur ? `blur(${blur}px)` : "none" });
    tl.fromTo(n.el, { x: sx, y: sy, scale: fs * 0.7, rotation: fr + (i % 2 ? 120 : -120) }, { x: fx, y: fy, scale: fs, rotation: fr, duration: 1.1, ease: "expo.out" }, T.enter + i * 0.06);
    tl.fromTo(n.el, { x: fx, y: fy, scale: fs, rotation: fr, filter: blur ? `blur(${blur}px)` : "blur(0px)" }, { x: wx, y: wy, scale: 1.12, rotation: 0, filter: "blur(0px)", duration: 0.7, ease: "power4.inOut" }, T.wallIn + i * 0.025);
    n.lockAt = T.locks + i * 0.07;
    tl.fromTo(n.lock, { scale: 0, rotation: -40 }, { scale: 1, rotation: 0, duration: 0.34, ease: "back.out(2.6)" }, n.lockAt);
    tl.fromTo(n.el.querySelector(".sh"), { y: -3 }, { y: 0, duration: 0.2, ease: "power2.in" }, n.lockAt);
    cue(n.lockAt + 0.12, "lock", { i });
    const f = T.flip + i * 0.04;
    tl.fromTo(n.lock, { scale: 1 }, { scale: 0, duration: 0.16, ease: "power2.in" }, f - 0.04);
    tl.fromTo(n.flip, { rotationY: 0 }, { rotationY: 180, duration: 0.5, ease: "back.inOut(1.4)" }, f);
    tl.fromTo(n.flip, { scale: 1 }, { scale: 1.08, duration: 0.16, ease: "power2.out", yoyo: true, repeat: 1 }, f + 0.1);
    tl.fromTo(n.el, { x: wx, y: wy, scale: 1.12, rotation: 0 }, { x: 960, y: 560, scale: 0.04, rotation: i % 2 ? 200 : -200, duration: 0.3, ease: "power3.in" }, T.out + i * 0.012);
    proc((t) => {
      const k = t < T.wallIn ? 1 : clamp(1 - prog(t, T.wallIn, T.wallIn + 0.4));
      n.drift.style.transform = k ? `translate3d(${Math.sin(t * 1.7 + i * 1.3) * 10 * k}px, ${Math.cos(t * 1.3 + i * 2.1) * 14 * k}px, ${Math.sin(t * 1.1 + i) * 30 * k}px)` : "none";
    });
  });
  // the wall settles at 3.73 s; the names and prices hold until the locks go, the replacements until the implode
  read($$(".front .nm", layer), 3.85, T.headOut, "rented tile names");
  read($$(".front .price", layer), 3.85, T.headOut, "rented prices");
  read($$(".back .nm", layer), 6.15, T.out, "replacement names");
  read($$(".back .price", layer), 6.15, T.out, "yours pills");
  cue(T.flip + 0.1, "flip");
  cue(T.wallIn, "whoosh", { dur: 0.6, pan: 0 });
  cue(T.out, "suck", { dur: 0.3 });

  const [wStop, wRent, wYour, wSoft] = $$("#hook-t .w");
  [wStop, wRent, wYour, wSoft].forEach((w, i) => {
    tl.fromTo(w, { yPercent: 190, rotation: i % 2 ? 7 : -7, scaleY: 1.25 }, { yPercent: 0, rotation: 0, scaleY: 1, duration: 0.7, ease: "expo.out" }, T.words + i * 0.1);
    tl.fromTo(w, { yPercent: 0 }, { yPercent: -190, duration: 0.3, ease: "power3.in" }, T.hookOut + i * 0.025);
    cue(T.words + i * 0.1 + 0.05, "thump", { i });
  });
  read("#hook-t", 1.15, T.hookOut, "hook");

  const whA = $("#wh-a"), whB = $("#wh-b");
  tl.fromTo(whA, { yPercent: 190, rotation: 5 }, { yPercent: 0, rotation: 0, duration: 0.6, ease: "expo.out" }, T.head);
  tl.fromTo(whA, { yPercent: 0 }, { yPercent: -190, duration: 0.3, ease: "power3.in" }, T.headOut);
  tl.fromTo(whB, { yPercent: 190, rotation: 5 }, { yPercent: 0, rotation: 0, duration: 0.6, ease: "expo.out" }, T.yours);
  tl.fromTo(whB, { yPercent: 0 }, { yPercent: -190, duration: 0.25, ease: "power3.in" }, T.out);
  read(whA, 4.0, T.headOut);
  read(whB, 6.25, T.out);

  const mN = $("#m-n"), l1 = $("#m-l1"), l2 = $("#m-l2");
  tl.fromTo("#meter", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, 3.4);
  tl.fromTo("#meter", { opacity: 1 }, { opacity: 0, duration: 0.2 }, T.out);
  tl.fromTo(l1, { opacity: 1 }, { opacity: 0, duration: 0.15 }, T.flip);
  tl.fromTo(l2, { opacity: 0 }, { opacity: 1, duration: 0.25 }, T.yours);
  proc((t) => {
    let sum = 0;
    nodes.forEach((n) => { if (t >= n.lockAt + 0.06) sum += n.tile.price; });
    const down = prog(t, T.flip + 0.05, T.flip + 0.55);
    const v = Math.round(sum * (1 - down * down));
    mN.textContent = `$${v}`;
    const green = t >= T.flip + 0.55;
    mN.style.color = green ? "#00d787" : "#ff5f5f";
    mN.style.textShadow = green ? "0 0 50px rgba(0,215,135,.45)" : "0 0 50px rgba(255,95,95,.45)";
  });
  read(mN, 4.45, T.flip + 0.05, `$${TOTAL}`);
  read(mN, 6.0, T.out, "$0");
  read(l1, 3.8, T.flip);
  read(l2, 5.9, T.out);
  return nodes;
}
