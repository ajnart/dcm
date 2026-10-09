import { gsap, $, $$, proc, prog, clamp, scene, diamond, rng } from "./lib.js";

const FLAGS = [
  "self-host install sonarr radarr qbittorrent --exposure lan --media-root ~/media --downloads-root ~/downloads --admin-user admin --yes --json",
  "--set sonarr.port=8989 --set radarr.port=7878 --set-file vaultwarden.admin_token=./token --exposure local",
  "self-host config set LAN_IP=auto TZ=Europe/Paris PUID=1000 PGID=1000 UMASK=002 && self-host config review --yes",
  "self-host backup --encrypt -o ~/.self-host/backups/selfhost-2026-10-09.tar.zst.age && self-host restore --yes",
  "self-host update jellyfin sonarr radarr && self-host status --updates --json && self-host doctor --json",
  "self-host logs jellyfin --follow --tail 200 | grep -i error && self-host restart prowlarr sonarr radarr",
];

export function build(tl) {
  const root = scene("s6", 14.7, 17.0);
  tl.fromTo(root, { clipPath: diamond(960, 540, 0) }, { clipPath: diamond(960, 540, 1900), duration: 0.5, ease: "power3.inOut" }, 14.7);
  const wrap = $("#flags");
  const r = rng(5);
  const lines = Array.from({ length: 15 }, (_, i) => {
    const txt = FLAGS[i % FLAGS.length] + "   ·   ";
    const el = document.createElement("div");
    el.className = "fl";
    el.textContent = txt.repeat(3);
    el.style.top = `${i * 76 - 10}px`;
    wrap.appendChild(el);
    return { el, loop: txt.length * 18, dir: i % 2 ? 1 : -1, sp: 260 + r() * 520, off: r() * 3000 };
  });
  proc((t) => {
    const age = t - 14.7;
    lines.forEach((l) => {
      const x = (((age * l.sp + l.off) % l.loop) + l.loop) % l.loop;
      l.el.style.transform = `translateX(${l.dir > 0 ? -l.loop + x : -x}px)`;
    });
    const dim = 0.3 - 0.2 * prog(t, 14.9, 15.5);
    wrap.style.opacity = dim * (1 - prog(t, 16.3, 16.6));
  });
  tl.fromTo("#flags", { scale: 1.0 }, { scale: 1.12, duration: 2.3, ease: "none" }, 14.7);

  const ws = $$("#pivot .w");
  ws.forEach((w, i) => {
    const q = w.classList.contains("q");
    tl.fromTo(w, { yPercent: 190, rotation: q ? 18 : 4, scale: q ? 0.4 : 1 }, { yPercent: 0, rotation: 0, scale: 1, duration: q ? 0.5 : 0.6, ease: q ? "back.out(2.4)" : "expo.out" }, 14.86 + (q ? 0.62 : i * 0.085));
    tl.fromTo(w, { yPercent: 0 }, { yPercent: -190, duration: 0.3, ease: "power3.in" }, 16.2 + i * 0.02);
  });
  tl.fromTo("#pivot", { scale: 1 }, { scale: 1.05, duration: 1.6, ease: "none" }, 14.86);
}
