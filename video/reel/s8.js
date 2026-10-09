import { gsap, $, $$, proc, prog, clamp, scene, icon, chars, rng } from "./lib.js";

const MOSAIC = ["qbittorrent", "sonarr", "radarr", "prowlarr", "jellyfin", "seerr", "homarr", "immich", "vaultwarden", "navidrome", "nextcloud", "paperless-ngx", "pi-hole", "adguard-home", "grafana", "uptime-kuma", "syncthing", "tailscale", "ollama", "open-webui", "audiobookshelf", "bazarr", "home-assistant", "beszel", "portainer", "docker"];
const A = 22.82;
export const END_INSTALL = "curl -fsSL https://raw.githubusercontent.com/ajnart/selfhost-skills/main/new-cli/install.sh | bash";

export function build(tl) {
  const root = scene("s8", A, 25.2);
  tl.fromTo(root, { clipPath: "circle(0px at 1260px 850px)" }, { clipPath: "circle(2300px at 1260px 850px)", duration: 0.65, ease: "power3.inOut" }, A);

  const imgs = MOSAIC.map((id) => { const im = new Image(); im.src = icon(id); document.body.appendChild(im); im.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none"; return im; });
  const bmps = imgs.map(() => null);
  window.__prepMosaic = async () => {
    await Promise.all(imgs.map((im) => im.decode().catch(() => {})));
    imgs.forEach((im, i) => {
      const c = document.createElement("canvas");
      c.width = c.height = 192;
      const ar = im.naturalWidth / im.naturalHeight;
      const w = ar >= 1 ? 192 : 192 * ar, h = ar >= 1 ? 192 / ar : 192;
      c.getContext("2d", { willReadFrequently: true }).drawImage(im, (192 - w) / 2, (192 - h) / 2, w, h);
      bmps[i] = c;
    });
  };
  const cv = $("#mosaic"), g = cv.getContext("2d", { willReadFrequently: true });
  const r = rng(21);
  const cells = [];
  const COLS = 14, ROWS = 8, CW = 168, CH = 168;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) cells.push({ x, y, k: Math.floor(r() * imgs.length), ph: r() * 6.28 });
  proc((t) => {
    if (t < A) return;
    g.clearRect(0, 0, 1920, 1080);
    const age = t - A;
    cells.forEach((c) => {
      const row = c.y;
      const sp = (row % 2 ? 1 : -1) * 36;
      const x = ((c.x * CW + age * sp) % (COLS * CW) + COLS * CW) % (COLS * CW) - CW;
      const y = row * CH - 60;
      const pulse = 0.5 + 0.5 * Math.sin(age * 2 + c.ph);
      const sz = 84 + pulse * 6;
      g.globalAlpha = (0.12 + 0.05 * pulse) * clamp(age / 0.5);
      const bm = bmps[c.k];
      if (bm) g.drawImage(bm, x + CW / 2 - sz / 2, y + CH / 2 - sz / 2, sz, sz);
    });
    g.globalAlpha = 1;
  });

  const end = $("#end");
  end.innerHTML = `
    <div class="e-dia"><svg viewBox="0 0 100 100"><path d="M50 4 96 50 50 96 4 50Z"/></svg></div>
    <div class="e-wm" id="e-wm">self-host</div>
    <div class="e-cmd mk2"><div class="e-cmdin" id="e-cmd"><span class="pr">$</span> ${END_INSTALL}</div></div>
    <div class="e-stats" id="e-stats"><span><b>93</b> Apps</span><i>·</i><span><b>20</b> Recipes</span><i>·</i><span><b>1</b> binary</span></div>
    <div class="e-ag" id="e-ag">Claude Code <i>·</i> OpenCode <i>·</i> Codex <i>·</i> Pi</div>`;
  const wm = $("#e-wm");
  const letters = chars(wm);
  tl.fromTo(".e-dia", { scale: 0, rotation: -180 }, { scale: 1, rotation: 0, duration: 0.8, ease: "back.out(1.7)" }, A + 0.18);
  tl.fromTo(".e-dia", { y: 0 }, { y: -8, duration: 1.2, ease: "sine.inOut", yoyo: true, repeat: 1 }, A + 1.0);
  letters.forEach((c, i) => tl.fromTo(c, { y: 130, opacity: 0, rotation: i % 2 ? 8 : -8 }, { y: 0, opacity: 1, rotation: 0, duration: 0.55, ease: "expo.out" }, A + 0.3 + i * 0.04));
  tl.fromTo("#e-cmd", { clipPath: "inset(0 100% 0 0)", y: 20, opacity: 0 }, { clipPath: "inset(0 0% 0 0)", y: 0, opacity: 1, duration: 0.65, ease: "power3.out" }, A + 0.7);
  tl.fromTo("#e-stats", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "expo.out" }, A + 1.05);
  tl.fromTo("#e-ag", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "expo.out" }, A + 1.2);
  tl.fromTo("#end", { scale: 1.0 }, { scale: 1.03, duration: 2.4, ease: "none" }, A);
  tl.fromTo("#flash", { opacity: 0 }, { opacity: 0.5, duration: 0.05 }, A + 0.55);
  tl.fromTo("#flash", { opacity: 0.5 }, { opacity: 0, duration: 0.3 }, A + 0.6);
}
