import { gsap, $, $$, proc, prog, lerp, clamp, scene, icon } from "./lib.js";

export const TILES = [
  { id: "netflix", name: "Netflix", price: 15, rep: "jellyfin", repName: "Jellyfin", from: [210, 214, 0.74, -13], wall: [0, 0] },
  { id: "spotify", name: "Spotify", price: 12, rep: "navidrome", repName: "Navidrome", from: [1708, 168, 0.62, 12], wall: [1, 0] },
  { id: "dropbox", name: "Dropbox", price: 12, rep: "nextcloud", repName: "Nextcloud", from: [128, 650, 0.86, 9], wall: [2, 0] },
  { id: "google-drive", name: "Drive", price: 10, rep: "syncthing", repName: "Syncthing", from: [1800, 586, 0.7, -10], wall: [3, 0] },
  { id: "google-photos", name: "Photos", price: 10, rep: "immich", repName: "Immich", from: [452, 948, 0.62, 16], wall: [0, 1] },
  { id: "1password", name: "1Password", price: 3, rep: "vaultwarden", repName: "Vaultwarden", light: true, from: [1500, 930, 0.8, -12], wall: [1, 1] },
  { id: "notion", name: "Notion", price: 10, rep: "docmost", repExt: "png", repName: "Docmost", light: true, from: [690, 132, 0.5, 8], wall: [2, 1] },
  { id: "chatgpt", name: "ChatGPT", price: 20, rep: "open-webui", repName: "Open WebUI", from: [1236, 140, 0.55, -9], wall: [3, 1] },
];

const LOCK = `<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9.5" rx="2.4"/><path class="sh" d="M8 11V7.6a4 4 0 0 1 8 0V11"/></svg>`;
const T = { enter: 0.04, wallIn: 1.9, locks: 2.6, flip: 3.34, implode: 4.08 };
export const WALL = (tile) => [960 + (tile.wall[0] - 1.5) * 322, 684 + (tile.wall[1] - 0.5) * 322];

export function build(tl) {
  scene("s1", 0, 4.75);
  const layer = $("#tiles");
  const nodes = TILES.map((tile, i) => {
    const el = document.createElement("div");
    el.className = "tile";
    el.innerHTML = `<div class="drift"><div class="flip">
      <div class="face front${tile.light ? " light" : ""}"><img src="${icon(tile.id)}"><div class="nm">${tile.name}</div><div class="price">$${tile.price}/mo</div><div class="lock">${LOCK}</div></div>
      <div class="face back"><img src="${icon(tile.rep, tile.repExt)}"><div class="nm">${tile.repName}</div><div class="price">yours</div></div>
    </div></div>`;
    layer.appendChild(el);
    return { tile, el, drift: $(".drift", el), flip: $(".flip", el), lock: $(".lock", el) };
  });

  const glow = $("#s1-glow");
  tl.fromTo(glow, { x: 1500, y: 300, scale: 0.8 }, { x: 460, y: 620, scale: 1.1, duration: 2, ease: "power2.out" }, 0);
  tl.fromTo(glow, { x: 460, y: 620, scale: 1.1 }, { x: 960, y: 620, scale: 1.5, duration: 1.0, ease: "power2.inOut" }, 2);

  nodes.forEach((n, i) => {
    const [fx, fy, fs, fr] = n.tile.from;
    const dx = fx - 960, dy = fy - 540;
    const len = Math.hypot(dx, dy);
    const sx = fx + (dx / len) * 1500, sy = fy + (dy / len) * 1500;
    const [wx, wy] = WALL(n.tile);
    const blur = fs > 0.78 ? 6 : fs < 0.58 ? 3 : 0;
    gsap.set(n.el, { filter: blur ? `blur(${blur}px)` : "none" });
    tl.fromTo(n.el, { x: sx, y: sy, scale: fs * 0.7, rotation: fr + (i % 2 ? 120 : -120) }, { x: fx, y: fy, scale: fs, rotation: fr, duration: 1.0, ease: "expo.out" }, T.enter + i * 0.06);
    tl.fromTo(n.el, { x: fx, y: fy, scale: fs, rotation: fr, filter: blur ? `blur(${blur}px)` : "blur(0px)" }, { x: wx, y: wy, scale: 1.12, rotation: 0, filter: "blur(0px)", duration: 0.62, ease: "power4.inOut" }, T.wallIn + i * 0.03);
    n.lockAt = T.locks + i * 0.07;
    tl.fromTo(n.lock, { scale: 0, rotation: -40 }, { scale: 1, rotation: 0, duration: 0.34, ease: "back.out(2.6)" }, n.lockAt);
    tl.fromTo(n.el.querySelector(".sh"), { y: -3 }, { y: 0, duration: 0.2, ease: "power2.in" }, n.lockAt);
    const f = T.flip + i * 0.03;
    tl.fromTo(n.lock, { scale: 1 }, { scale: 0, duration: 0.18, ease: "power2.in" }, f - 0.02);
    tl.fromTo(n.flip, { rotationY: 0 }, { rotationY: 180, duration: 0.5, ease: "back.inOut(1.4)" }, f);
    tl.fromTo(n.el, { x: wx, y: wy, scale: 1.12, rotation: 0 }, { x: 960, y: 560, scale: 0.04, rotation: i % 2 ? 200 : -200, duration: 0.3, ease: "power3.in" }, T.implode + i * 0.012);
    tl.fromTo(n.flip, { scale: 1 }, { scale: 1.1, duration: 0.18, ease: "power2.out", yoyo: true, repeat: 1 }, f + 0.1);
    proc((t) => {
      const d = n.drift;
      const k = t < T.wallIn ? 1 : clamp(1 - prog(t, T.wallIn, T.wallIn + 0.4));
      d.style.transform = `translate3d(${Math.sin(t * 1.7 + i * 1.3) * 10 * k}px, ${Math.cos(t * 1.3 + i * 2.1) * 14 * k}px, ${Math.sin(t * 1.1 + i) * 30 * k}px)`;
    });
  });
  tl.fromTo("#tiles", { scale: 1, rotation: 0 }, { scale: 1.06, rotation: -1.2, duration: 2.0, ease: "none" }, 1.9);

  const wordsIn = $$("#hook .w");
  const [wStop, wRent, wYour, wOwn, wStuff] = wordsIn;
  [wStop, wRent, wYour, wOwn, wStuff].forEach((w, i) => {
    tl.fromTo(w, { yPercent: 190, rotation: i % 2 ? 7 : -7, scaleY: 1.25 }, { yPercent: 0, rotation: 0, scaleY: 1, duration: 0.7, ease: "expo.out" }, 0.14 + i * 0.1);
    tl.fromTo(w, { yPercent: 0 }, { yPercent: -190, duration: 0.3, ease: "power3.in" }, T.wallIn - 0.04 + i * 0.025);
  });
  tl.fromTo("#w-renting", { "--sk": "0%" }, { "--sk": "104%", duration: 0.28, ease: "power3.out" }, 1.08);
  tl.fromTo("#w-renting", { color: "#f5f5f5" }, { color: "#ff5f5f", duration: 0.12 }, 1.2);
  proc((t) => {
    const s = Math.exp(-(t - 1.12) * 18) * Math.sin((t - 1.12) * 90) * 9;
    wRent.style.translate = t > 1.12 && t < 1.7 ? `${s}px 0` : "0 0";
  });

  const whA = $("#wh-a"), whB = $("#wh-b");
  tl.fromTo(whA, { yPercent: 190, rotation: 5 }, { yPercent: 0, rotation: 0, duration: 0.6, ease: "expo.out" }, 2.3);
  tl.fromTo(whA, { yPercent: 0 }, { yPercent: -190, duration: 0.3, ease: "power3.in" }, 3.3);
  tl.fromTo(whB, { yPercent: 190, rotation: 5 }, { yPercent: 0, rotation: 0, duration: 0.6, ease: "expo.out" }, 3.44);
  tl.fromTo("#wallhead", { yPercent: 0, opacity: 1 }, { yPercent: -20, opacity: 0, duration: 0.2, ease: "power2.in" }, 4.06);

  const meter = $("#meter"), mN = $("#m-n"), mL = $(".m-l");
  tl.fromTo(meter, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, 2.4);
  tl.fromTo(meter, { opacity: 1 }, { opacity: 0, duration: 0.2 }, 4.1);
  proc((t) => {
    let sum = 0;
    nodes.forEach((n) => { if (t >= n.lockAt + 0.06) sum += n.tile.price; });
    const down = prog(t, 3.4, 3.9);
    const v = Math.round(sum * (1 - down * down));
    mN.textContent = `$${v}`;
    const green = t > 3.85;
    mN.style.color = green ? "#00d787" : "#ff5f5f";
    mN.style.textShadow = green ? "0 0 50px rgba(0,215,135,.45)" : "0 0 50px rgba(255,95,95,.45)";
    mL.textContent = t < 3.4 ? "per month, rented" : "per month, yours";
  });
  return nodes;
}
