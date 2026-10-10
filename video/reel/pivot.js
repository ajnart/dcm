import { $, $$, proc, prog, scene, diamond, rng, read, cue } from "./lib.js";
import { SC, shown } from "./timeline.js";

const [A, B] = SC.pivot;
const FLAGS = [
  "self-host install sonarr radarr qbittorrent --exposure lan --media-root ~/media --downloads-root ~/downloads --admin-user admin --yes --json",
  "--set sonarr.port=8989 --set radarr.port=7878 --set-file vaultwarden.admin_token=./token --exposure local",
  "self-host config set LAN_IP=auto TZ=Europe/Paris PUID=1000 PGID=1000 UMASK=002 && self-host config review --yes",
  "self-host backup --encrypt -o ~/.self-host/backups/selfhost-2026-10-09.tar.zst.age && self-host restore --yes",
  "self-host update jellyfin sonarr radarr && self-host status --updates --json && self-host doctor --json",
  "self-host logs jellyfin --follow --tail 200 | grep -i error && self-host restart prowlarr sonarr radarr",
];
const IN = A + 0.15, OUT = B - 0.3;

export function build(tl) {
  const root = scene("pivot", A, shown("pivot"));
  tl.fromTo(root, { clipPath: diamond(960, 540, 0) }, { clipPath: diamond(960, 540, 1900), duration: 0.5, ease: "power3.inOut" }, A);
  cue(A, "whoosh", { dur: 0.5, pan: 0 });
  const wrap = $("#flags");
  const r = rng(5);
  const lines = Array.from({ length: 15 }, (_, i) => {
    const txt = FLAGS[i % FLAGS.length] + "   ·   ";
    const el = document.createElement("div");
    el.className = "fl";
    el.textContent = txt.repeat(3);
    el.style.top = `${i * 76 - 10}px`;
    wrap.appendChild(el);
    return { el, loop: txt.length * 18, dir: i % 2 ? 1 : -1, sp: 180 + r() * 360, off: r() * 3000 };
  });
  proc((t) => {
    if (t < A || t > shown("pivot")) return;
    const age = t - A;
    lines.forEach((l) => {
      const x = (((age * l.sp + l.off) % l.loop) + l.loop) % l.loop;
      l.el.style.transform = `translateX(${l.dir > 0 ? -l.loop + x : -x}px)`;
    });
    wrap.style.opacity = (0.3 - 0.18 * prog(t, A + 0.2, A + 0.9)) * (1 - prog(t, OUT, OUT + 0.3));
  });

  const ws = $$("#pivot-t .w");
  ws.forEach((w, i) => {
    const q = w.classList.contains("q");
    const t0 = IN + (q ? 0.62 : i * 0.085);
    tl.fromTo(w, { yPercent: 190, rotation: q ? 18 : 4, scale: q ? 0.4 : 1 }, { yPercent: 0, rotation: 0, scale: 1, duration: q ? 0.5 : 0.6, ease: q ? "back.out(2.4)" : "expo.out" }, t0);
    tl.fromTo(w, { yPercent: 0 }, { yPercent: -190, duration: 0.3, ease: "power3.in" }, OUT + i * 0.02);
    if (q) cue(t0 + 0.12, "plink");
  });
  read("#pivot-t", IN + 1.15, OUT, "pivot");
}
