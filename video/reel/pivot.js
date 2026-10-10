import { $, $$, proc, scene, rng, read, on, cut } from "./lib.js";
import { SC, b, BEAT } from "./timeline.js";

const [A, B] = SC.pivot;
const FLAGS = [
  "self-host install sonarr radarr qbittorrent --exposure lan --media-root ~/media --downloads-root ~/downloads --yes --json",
  "--set sonarr.port=8989 --set radarr.port=7878 --set-file vaultwarden.admin_token=./token --exposure local",
  "self-host config set LAN_IP=auto TZ=Europe/Paris PUID=1000 PGID=1000 && self-host config review --yes",
  "self-host backup --encrypt -o ~/.self-host/backups/selfhost-2026-10-09.tar.zst.age && self-host restore --yes",
  "self-host update jellyfin sonarr radarr && self-host status --updates --json && self-host doctor --json",
  "self-host logs jellyfin --follow --tail 200 | grep -i error && self-host restart prowlarr sonarr radarr",
];
const IN = 0.2;
// beats: 0 line one · ½ line two · then the wall of real flags steps sideways on every beat

export function build(tl) {
  scene("pivot", A, B);
  cut(A, "Don't want to learn the CLI?");
  const wrap = $("#flags");
  const r = rng(5);
  const lines = Array.from({ length: 14 }, (_, i) => {
    const el = document.createElement("div");
    el.className = "fl";
    el.textContent = (FLAGS[i % FLAGS.length] + "   ").repeat(3);
    el.style.top = `${i * 78}px`;
    wrap.appendChild(el);
    return { el, dir: i % 2 ? 1 : -1, off: -200 - r() * 900 };
  });
  // the wall moves in steps: one expo step of 140 px on each beat, nothing in between
  const step = (t) => {
    let s = 0;
    for (let k = 0; ; k++) {
      const tk = A + BEAT + k * BEAT;
      if (tk > t || tk >= B) break;
      const p = Math.min(1, (t - tk) / 0.25);
      s += 1 - Math.pow(2, -10 * p);
    }
    return s;
  };
  proc((t) => {
    if (t < A || t >= B) return;
    const s = step(t);
    lines.forEach((l) => { l.el.style.transform = `translateX(${(l.off + l.dir * s * 140).toFixed(2)}px)`; });
  });
  for (let k = 1; A + k * BEAT < B - 1e-6; k++) on(A + k * BEAT, "flags step");

  const ws = $$("#pivot-t .w");
  tl.fromTo(ws[0], { yPercent: 110 }, { yPercent: 0, duration: IN, ease: "expo.out" }, A);
  tl.fromTo(ws[1], { yPercent: 110 }, { yPercent: 0, duration: IN, ease: "expo.out" }, A + BEAT / 2);
  read("#pivot-t", A + BEAT / 2 + IN, B - 0.01, "pivot");
}
