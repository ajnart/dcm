import { gsap, $, $$, proc, prog, scene, icon, read, cue } from "./lib.js";
import { SC, shown } from "./timeline.js";

const [A, B] = SC.links;
// What each Link really does, from new-cli/internal/apps:
//   arr/links.go    downloadClientLink: Sonarr/Radarr get qBittorrent as download client with the Admin login
//   arr/links.go    applicationLink: Prowlarr syncs indexers to Sonarr/Radarr with their API keys
//   seerr/seerr.go  serverLink: Seerr sends requests to Sonarr/Radarr with their API keys
//   homarr/links.go target.link: Homarr adds a Jellyfin app tile, integration (API key) and widgets
const CARDS = [
  { from: "sonarr", fromName: "Sonarr", to: ["qbittorrent"], toName: "qBittorrent", desc: "Adds qBittorrent as Sonarr’s download client", key: "Admin login" },
  { from: "prowlarr", fromName: "Prowlarr", to: ["sonarr", "radarr"], toName: "Sonarr · Radarr", desc: "Syncs Prowlarr’s indexers to Sonarr and Radarr", key: "Their API keys" },
  { from: "seerr", fromName: "Seerr", to: ["sonarr", "radarr"], toName: "Sonarr · Radarr", desc: "Sends your requests to Sonarr and Radarr", key: "Their API keys" },
  { from: "homarr", fromName: "Homarr", to: ["jellyfin"], toName: "Jellyfin", desc: "Adds a Jellyfin tile and widgets to Homarr", key: "Jellyfin API key" },
];
const KEY = `<svg viewBox="0 0 24 24"><circle cx="7.5" cy="12" r="4.2"/><path d="M11.7 12H21M17.5 12v3.4M20.5 12v2.4"/></svg>`;
const CAP_IN = A + 0.1, OUT = B - 0.25;
const at = (k) => A + 0.35 + k * 0.6;
const wireEnd = (c) => 824 - 40 - c.to.length * 104 - (c.to.length - 1) * 12 - 22;

export function build(tl) {
  const root = scene("links", A, shown("links"));
  tl.fromTo(root, { clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 0%)", duration: 0.4, ease: "power3.out" }, A);
  const grid = $("#lk-grid");
  grid.innerHTML = CARDS.map((c, k) => `
    <div class="lkc" id="lkc${k}">
      <svg class="wire" width="824" height="200" viewBox="0 0 824 200"><line class="w0" x1="166" y1="88" x2="${wireEnd(c)}" y2="88"/><line class="w1" x1="166" y1="88" x2="${wireEnd(c)}" y2="88" pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="100"/></svg>
      <div class="ic l"><div class="sq"><img src="${icon(c.from)}"></div><div class="ok">✓</div></div>
      <div class="ic r${c.to.length > 1 ? " two" : ""}">${c.to.map((id) => `<div class="sq"><img src="${icon(id)}"></div>`).join("")}</div>
      <div class="nm l">${c.fromName}</div><div class="nm r">${c.toName}</div>
      <div class="pk" data-deco>${KEY}<span>••••</span></div>
      <div class="desc">${c.desc}</div>
      <div class="key"><b>${KEY}</b><span class="kl">${c.key}</span> <span class="mask">••••••</span></div>
    </div>`).join("");

  CARDS.forEach((c, k) => {
    const el = $(`#lkc${k}`), t0 = at(k);
    tl.fromTo(el, { y: 70, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1, duration: 0.5, ease: "expo.out" }, t0);
    cue(t0 + 0.05, "pop", { i: k });
    const w1 = $(".w1", el), pk = $(".pk", el), keyl = $(".key", el), ok = $(".ok", el), sq = $(".ic.l .sq", el);
    tl.fromTo(w1, { attr: { "stroke-dashoffset": 100 } }, { attr: { "stroke-dashoffset": 0 }, duration: 0.35, ease: "power2.inOut" }, t0 + 0.45);
    cue(t0 + 0.45, "zip");
    // the credential travels from the App that owns it to the App being configured
    const px = wireEnd(c) - 130;
    tl.fromTo(pk, { x: px, opacity: 0, scale: 0.6 }, { x: px, opacity: 1, scale: 1, duration: 0.15 }, t0 + 0.8);
    tl.fromTo(pk, { x: px }, { x: 150, duration: 0.5, ease: "power2.inOut" }, t0 + 0.9);
    tl.fromTo(pk, { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.4, duration: 0.15, ease: "power2.in" }, t0 + 1.35);
    cue(t0 + 0.9, "pass", { dur: 0.5 });
    tl.fromTo(ok, { scale: 0 }, { scale: 1, duration: 0.3, ease: "back.out(3)" }, t0 + 1.4);
    tl.fromTo(sq, { scale: 1 }, { scale: 1.1, duration: 0.12, ease: "power2.out", yoyo: true, repeat: 1 }, t0 + 1.4);
    tl.fromTo(keyl, { opacity: 0 }, { opacity: 1, duration: 0.2 }, t0 + 1.4);
    cue(t0 + 1.4, "check", { i: k + 3 });
    proc((t) => {
      const on = t >= t0 + 1.4;
      w1.setAttribute("stroke", on ? "#00d787" : "#a88df2");
      el.classList.toggle("on", on);
    });
    read([$(".nm.l", el), $(".nm.r", el), $(".desc", el)], t0 + 0.55, OUT, `link ${c.fromName}`);
    read(keyl, t0 + 1.65, OUT, `key ${c.fromName}`);
  });
  tl.fromTo("#lk-grid", { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.94, duration: 0.25, ease: "power2.in" }, OUT);

  const w = $("#cap-links .w");
  tl.fromTo(w, { yPercent: 190, rotation: 3 }, { yPercent: 0, rotation: 0, duration: 0.55, ease: "expo.out" }, CAP_IN);
  tl.fromTo(w, { yPercent: 0 }, { yPercent: -190, duration: 0.25, ease: "power3.in" }, OUT);
  cue(CAP_IN + 0.04, "thump", { i: 1 });
  read("#cap-links", CAP_IN + 0.6, OUT);
}
