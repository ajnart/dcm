import { $, $$, proc, scene, rng, read, cue, on, cut, drift } from "./lib.js";
import { SC, BEAT } from "./timeline.js";

const [A, B] = SC.pivot;
const FLAGS = [
  "self-host install sonarr radarr qbittorrent --exposure lan --media-root ~/media --downloads-root ~/downloads --yes --json",
  "--set sonarr.port=8989 --set radarr.port=7878 --set-file vaultwarden.admin_token=./token --exposure local",
  "self-host config set LAN_IP=auto TZ=Europe/Paris PUID=1000 PGID=1000 && self-host config review --yes",
  "self-host backup --encrypt -o ~/.self-host/backups/selfhost-2026-10-09.tar.zst.age && self-host restore --yes",
  "self-host update jellyfin sonarr radarr && self-host status --updates --json && self-host doctor --json",
  "self-host logs jellyfin --follow --tail 200 | grep -i error && self-host restart prowlarr sonarr radarr",
];
// beats: 0 both lines land an eighth apart · then the wall of real flags lurches sideways on every beat,
// a little further each time, while the camera pushes in
export function build(tl) {
  scene("pivot", A, B);
  cut(A, "Don't want to learn the CLI?");
  drift($("#pivot-cam"), A, B, { s0: 1.06, s1: 1 });
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
  const step = (t) => {
    let s = 0;
    for (let k = 0; ; k++) {
      const tk = A + k * BEAT;
      if (tk > t || tk >= B) break;
      const p = Math.min(1, (t - tk) / 0.3);
      s += (1 + k * 0.35) * (1 - Math.pow(2, -10 * p));
    }
    return s;
  };
  proc((t) => {
    if (t < A || t >= B) return;
    const s = step(t);
    lines.forEach((l) => { l.el.style.transform = `translateX(${(l.off + l.dir * s * 150).toFixed(2)}px)`; });
  });
  for (let k = 1; A + k * BEAT < B - 1e-6; k++) { on(A + k * BEAT, "flags lurch"); cue(A + k * BEAT, "tick", { soft: true, pan: k % 2 ? 0.5 : -0.5 }); }

  const ws = $$("#pivot-t .w");
  [A, A + BEAT / 2].forEach((at, i) => {
    tl.fromTo(ws[i], { yPercent: 110, letterSpacing: "0.01em" }, { yPercent: 0, letterSpacing: "-0.055em", duration: 0.3, ease: "expo.out" }, at);
    cue(at, "slam", { g: 0.75 });
  });
  read("#pivot-t", A + BEAT / 2 + 0.3, B - 0.01, "pivot");
}
