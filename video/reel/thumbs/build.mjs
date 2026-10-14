import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
const font = (f) => `../node_modules/@fontsource-variable/${f}`;
const base = `
@font-face{font-family:"Inter Tight";src:url(${font("inter-tight/files/inter-tight-latin-wght-normal.woff2")});font-weight:100 900}
@font-face{font-family:"JetBrains Mono";src:url(${font("jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2")});font-weight:100 800}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100vw;height:100vh;overflow:hidden;background:#09080f;color:#f5f5f5;font-family:"Inter Tight",sans-serif;-webkit-font-smoothing:antialiased}
:root{--u:1vmin;--a:#7a57d3;--at:#a88df2;--ok:#00d787;--warn:#ffaf00;--mono:"JetBrains Mono",monospace}
.abs{position:absolute;inset:0}
.frame{position:absolute;inset:0;background-size:cover;background-position:center}
`;
const logo = `<img src="assets-logo.svg">`;
const ic = (n) => `<img src="../assets/icons/${n}.${n === "docmost" ? "png" : "svg"}">`;
const frame = (f, pos = "center") => ({ css: `.frame{background-image:url(frames/${f});background-position:${pos}}`, html: `<div class="frame"></div>` });
const V = [
  { id: "firstframe", name: "First frame (t=0)", ...frame("f-0.png") },
  { id: "stoprenting", name: "Stop renting your software", ...frame("f-1.5.png") },
  { id: "wall", name: "Their servers $92", ...frame("f-4.2.png") },
  { id: "yours", name: "Your servers $0", ...frame("f-5.6.png") },
  { id: "dashboard", name: "Builds your dashboard", ...frame("f-18.6.png", "center 40%") },
  { id: "endcard", name: "End card (logo + curl)", ...frame("f-33.5.png") },
  { id: "hook", name: "Designed: hook over dashboard", css: `
.frame{background-image:url(frames/f-18.6.png);filter:blur(calc(var(--u)*.9)) brightness(.45) saturate(1.2);background-size:170%;background-position:70% 78%}
.wrap{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 calc(var(--u)*9)}
.l{display:flex;align-items:center;gap:calc(var(--u)*2.4);margin-bottom:calc(var(--u)*5)}.l img{height:calc(var(--u)*9)}
.l b{font:800 calc(var(--u)*6) var(--mono)}
h1{font-weight:800;font-size:calc(var(--u)*15.5);line-height:.9;letter-spacing:-.04em}
h1 span{color:var(--at)} h1 em{font-style:normal;color:var(--ok)}
.bar{position:absolute;left:0;right:0;bottom:0;height:calc(var(--u)*1.6);background:var(--a)}`,
    html: `<div class="frame"></div><div class="wrap"><div class="l">${logo}<b>self-host</b></div><h1>Your <span>Apps.</span><br>Your home.<br>One <em>binary.</em></h1></div><div class="bar"></div>` },
  { id: "rentvsfree", name: "Designed: $92 vs $0 split", css: `
.s{position:absolute;top:0;bottom:0;width:50%;display:flex;flex-direction:column;justify-content:center;align-items:center}
.l{left:0;background:#1b0d12}.r{right:0;background:#07211a}
.k{font:700 calc(var(--u)*3.8) var(--mono);letter-spacing:.04em;margin-bottom:calc(var(--u)*1)}
.n{font-weight:800;font-size:calc(var(--u)*25);letter-spacing:-.05em;line-height:1}
.l .k,.l .n{color:#ff5f5f}.r .k,.r .n{color:var(--ok)}
.l .n{text-decoration:line-through;text-decoration-thickness:calc(var(--u)*1.6)}
.sub{font:600 calc(var(--u)*3.6) var(--mono);color:#aaa;margin-top:calc(var(--u)*2)}
.mid{position:absolute;left:50%;bottom:calc(var(--u)*6);transform:translateX(-50%);background:var(--a);padding:calc(var(--u)*2) calc(var(--u)*3);display:flex;gap:calc(var(--u)*2);align-items:center;font:800 calc(var(--u)*4.4) var(--mono)}
.mid img{height:calc(var(--u)*8)}`,
    html: `<div class="s l"><div class="k">THEIR SERVERS</div><div class="n">$92</div><div class="sub">per month</div></div><div class="s r"><div class="k">YOUR SERVER</div><div class="n">$0</div><div class="sub">per month</div></div><div class="mid">${logo}self-host</div>` },
  { id: "curl", name: "Designed: one command", css: `
body{background:radial-gradient(120% 90% at 50% 0%,#241a48,#09080f 70%)}
.wrap{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:calc(var(--u)*5)}
.t{font-weight:800;font-size:calc(var(--u)*13);letter-spacing:-.04em;text-align:center;line-height:.95}.t span{color:var(--at)}
.cmd{background:#14121e;border:calc(var(--u)*.3) solid #3a3358;padding:calc(var(--u)*3) calc(var(--u)*4);font:700 calc(var(--u)*4.6) var(--mono);color:#f5f5f5;white-space:nowrap}
.cmd i{font-style:normal;color:var(--ok)}
.foot{font:700 calc(var(--u)*3.6) var(--mono);color:var(--at)}`,
    html: `<div class="wrap"><div class="t">Install any App.<br><span>One command.</span></div><div class="cmd"><i>$</i> curl -fsSL self-host.fyi/install | bash</div><div class="foot">93 Apps · 7 Recipes · 1 binary</div></div>` },
  { id: "purplelogo", name: "Designed: giant logo on purple", css: `
body{background:var(--a)}
.wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:calc(var(--u)*7)}
.wrap img{height:calc(var(--u)*56);filter:drop-shadow(0 calc(var(--u)*2) 0 rgba(0,0,0,.28))}
h1{font:800 calc(var(--u)*12.5) var(--mono);letter-spacing:-.06em;line-height:1}
p{margin-top:calc(var(--u)*3);font:700 calc(var(--u)*4) "Inter Tight";background:#09080f;display:inline-block;padding:calc(var(--u)*1) calc(var(--u)*2)}`,
    html: `<div class="wrap">${logo}<div><h1>self-<br>host</h1><p>Your Apps. One binary.</p></div></div>` },
  { id: "links", name: "Designed: Links wires collage", css: `
.frame{background-image:url(frames/f-15.2.png);filter:blur(calc(var(--u)*.7)) brightness(.32);background-size:150%;background-position:80% 55%}.wrap:before{content:'';position:absolute;inset:-30vmin -10vmin -10vmin -10vmin;background:linear-gradient(90deg,#09080fe6,#09080f00);z-index:-1}
.wrap{position:absolute;left:calc(var(--u)*7);bottom:calc(var(--u)*8);z-index:1}
h1{font-weight:800;font-size:calc(var(--u)*13);letter-spacing:-.045em;line-height:.9;text-shadow:0 0 calc(var(--u)*4) #09080f}
h1 span{color:var(--ok)}
.tag{position:absolute;top:calc(var(--u)*6);left:calc(var(--u)*7);display:flex;gap:calc(var(--u)*2);align-items:center}.tag img{height:calc(var(--u)*6.5)}
.tag b{font:800 calc(var(--u)*4) var(--mono)}`,
    html: `<div class="frame"></div><div class="tag">${logo}<b>self-host</b></div><div class="wrap"><h1>Apps that<br><span>wire<br>themselves.</span></h1></div>` },
  { id: "splitbrand", name: "Mix: v8 split + brand bar + curl footer", css: `
.top{position:absolute;top:0;left:0;right:0;height:calc(var(--u)*13);background:var(--a);display:flex;align-items:center;justify-content:space-between;padding:0 calc(var(--u)*5)}
.lg{display:flex;align-items:center;gap:calc(var(--u)*2)}.lg img{height:54px}.lg b{font:800 calc(var(--u)*6.4) var(--mono);letter-spacing:-.03em}
.url{font:700 calc(var(--u)*3.8) var(--mono);color:#ffffffd9}
.mid{position:absolute;top:calc(var(--u)*13);bottom:calc(var(--u)*14);left:0;right:0;display:grid;grid-template-columns:1fr 1fr}
.s{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:calc(var(--u)*1.2)}
.l{background:#1b0d12}.r{background:#07211a}
.k{font:700 calc(var(--u)*3.4) var(--mono);letter-spacing:.04em}
.l .k,.l .n{color:#ff5f5f}.r .k,.r .n{color:var(--ok)}
.n{font-weight:800;font-size:calc(var(--u)*21);letter-spacing:-.05em;line-height:1}
.l .n{text-decoration:line-through;text-decoration-thickness:calc(var(--u)*1.5)}
.n small{font:700 calc(var(--u)*4.4) var(--mono);letter-spacing:0;text-decoration:none;display:inline-block}
.ics{display:flex;gap:calc(var(--u)*1.6);margin-top:calc(var(--u)*1.6)}.ics img{width:calc(var(--u)*8.5);height:calc(var(--u)*8.5);object-fit:contain}
.l .ics img{filter:grayscale(1) brightness(1.9);opacity:.7}
.bot{position:absolute;bottom:0;left:0;right:0;height:calc(var(--u)*14);background:#14121e;border-top:calc(var(--u)*.4) solid #3a3358;display:flex;align-items:center;justify-content:center;gap:calc(var(--u)*3);font:700 calc(var(--u)*4.6) var(--mono)}
.bot i{font-style:normal;color:var(--ok)}.bot em{font-style:normal;color:var(--at)}`,
    html: `<div class="top"><div class="lg">${logo}<b>self-host</b></div><div class="url">self-host.fyi</div></div>
<div class="mid"><div class="s l"><div class="k">8 SUBSCRIPTIONS</div><div class="n">$92<small>/mo</small></div><div class="ics">${ic("netflix")}${ic("spotify")}${ic("google-drive")}${ic("dropbox")}</div></div>
<div class="s r"><div class="k">8 APPS YOU OWN</div><div class="n">$0<small>/mo</small></div><div class="ics">${ic("jellyfin")}${ic("navidrome")}${ic("nextcloud")}${ic("immich")}</div></div></div>
<div class="bot"><i>$</i> curl -fsSL self-host.fyi/install | bash</div>` },
  { id: "herolockup", name: "Mix: Stop renting + $92→$0 + big logo + curl", css: `
body{background:radial-gradient(110% 90% at 85% 40%,#2d1f5e,#09080f 70%)}
.col{position:absolute;left:calc(var(--u)*8);top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:calc(var(--u)*4.2)}
.lg{display:flex;align-items:center;gap:calc(var(--u)*2.2)}.lg img{height:54px}.lg b{font:800 calc(var(--u)*5.6) var(--mono);letter-spacing:-.03em}
h1{font-weight:800;font-size:calc(var(--u)*14);line-height:.92;letter-spacing:-.045em}h1 span{color:var(--at)}
.p{display:flex;align-items:baseline;gap:calc(var(--u)*2.4);font:800 calc(var(--u)*8.6) var(--mono);letter-spacing:-.04em}
.p s{color:#ff5f5f;text-decoration-thickness:calc(var(--u)*.9)}.p b{color:var(--ok)}.p i{font-style:normal;color:#777}.p small{font:700 calc(var(--u)*3.6) var(--mono);color:#aaa;letter-spacing:0}
.cmd{align-self:flex-start;background:#14121e;border:calc(var(--u)*.3) solid #3a3358;padding:calc(var(--u)*2) calc(var(--u)*3);font:700 calc(var(--u)*3.8) var(--mono);white-space:nowrap}.cmd i{font-style:normal;color:var(--ok)}
.big{position:absolute;right:calc(var(--u)*7);top:50%;transform:translateY(-50%);height:432px;filter:drop-shadow(0 calc(var(--u)*2.5) calc(var(--u)*4) #000a)}`,
    html: `<div class="col"><div class="lg">${logo}<b>self-host</b></div><h1>Stop renting<br>your <span>software.</span></h1><div class="p"><s>$92</s><i>→</i><b>$0</b><small>/ month</small></div><div class="cmd"><i>$</i> curl -fsSL self-host.fyi/install | bash</div></div><img class="big" src="assets-logo.svg">` },
  { id: "bands", name: "Mix: rented wall / install band / owned wall", css: `
.t,.b{position:absolute;left:0;right:0;height:calc(var(--u)*38);display:flex;align-items:center;justify-content:space-between;padding:0 calc(var(--u)*7)}
.t{top:0;background:#1b0d12}.b{bottom:0;background:#07211a}
.band{position:absolute;left:0;right:0;top:calc(var(--u)*38);bottom:calc(var(--u)*38);background:var(--a);display:flex;align-items:center;justify-content:center;gap:calc(var(--u)*3.5)}
.band img{height:108px}.band b{font:800 calc(var(--u)*9) var(--mono);letter-spacing:-.04em}
.band div{display:flex;flex-direction:column;gap:calc(var(--u)*1)}.band span{font:700 calc(var(--u)*3.4) var(--mono);background:#09080f;padding:calc(var(--u)*.8) calc(var(--u)*1.6);align-self:flex-start}.band span i{font-style:normal;color:var(--ok)}
.g{display:grid;grid-template-columns:repeat(3,1fr);gap:calc(var(--u)*2);width:calc(var(--u)*50)}
.g img{width:calc(var(--u)*13);height:calc(var(--u)*13);object-fit:contain}
.t .g img{filter:grayscale(1) brightness(1.9);opacity:.7}
.k{font:700 calc(var(--u)*3.4) var(--mono);letter-spacing:.04em;margin-bottom:calc(var(--u)*.6)}
.n{font-weight:800;font-size:calc(var(--u)*24);letter-spacing:-.05em;line-height:1;text-align:right}
.t .k,.t .n{color:#ff5f5f}.b .k,.b .n{color:var(--ok)}.t .n u{text-decoration-thickness:calc(var(--u)*1.6)}
.n small{font:700 calc(var(--u)*4) var(--mono);letter-spacing:0;display:block;text-decoration:none;color:#aaa;margin-top:calc(var(--u)*.4)}
.tx{text-align:right}`,
    html: `<div class="t"><div class="g">${ic("netflix")}${ic("spotify")}${ic("google-drive")}${ic("dropbox")}${ic("google-photos")}${ic("chatgpt")}</div><div class="tx"><div class="k">THEIR SERVERS</div><div class="n"><u>$92</u><small>per month</small></div></div></div>
<div class="band">${logo}<div><b>self-host</b><span><i>$</i> curl -fsSL self-host.fyi/install | bash</span></div></div>
<div class="b"><div class="g">${ic("jellyfin")}${ic("navidrome")}${ic("nextcloud")}${ic("syncthing")}${ic("immich")}${ic("homarr")}</div><div class="tx"><div class="k">YOUR SERVER</div><div class="n">$0<small>per month</small></div></div></div>` },
  { id: "purplecard", name: "Mix: purple brand card, $92→$0, curl", css: `
body{background:var(--a)}
.logo{position:absolute;left:calc(var(--u)*7);top:50%;transform:translateY(-50%);height:372px;padding:24px;background:#1e1d2a;filter:drop-shadow(0 calc(var(--u)*1.6) 0 rgba(0,0,0,.28))}
.col{position:absolute;left:calc(var(--u)*78);right:calc(var(--u)*6);top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:calc(var(--u)*3.2)}
.w{font:800 calc(var(--u)*11.5) var(--mono);letter-spacing:-.06em;line-height:.95}
.h{font-weight:800;font-size:calc(var(--u)*6.6);letter-spacing:-.03em;line-height:1;color:#09080f}
.p{display:inline-flex;align-self:flex-start;gap:calc(var(--u)*2);align-items:baseline;background:#09080f;padding:calc(var(--u)*1.6) calc(var(--u)*2.6);font:800 calc(var(--u)*8) var(--mono);letter-spacing:-.04em}
.p s{color:#ff5f5f;text-decoration-thickness:calc(var(--u)*.8)}.p i{font-style:normal;color:#777}.p b{color:var(--ok)}.p small{font:700 calc(var(--u)*3.2) var(--mono);color:#aaa;letter-spacing:0}
.cmd{align-self:flex-start;background:#14121e;padding:calc(var(--u)*1.8) calc(var(--u)*2.6);font:700 calc(var(--u)*3.3) var(--mono);white-space:nowrap}.cmd i{font-style:normal;color:var(--ok)}`,
    html: `<img class="logo" src="assets-logo.svg"><div class="col"><div class="w">self-<br>host</div><div class="h">Install any App.<br>One command.</div><div class="p"><s>$92</s><i>→</i><b>$0</b><small>/mo</small></div><div class="cmd"><i>$</i> curl -fsSL self-host.fyi/install | bash</div></div>` },
  { id: "terminal", name: "Mix: terminal install + $0 badge + logo", css: `
body{background:radial-gradient(120% 90% at 0% 0%,#241a48,#09080f 70%)}
.lg{position:absolute;left:calc(var(--u)*7);top:calc(var(--u)*6);display:flex;align-items:center;gap:calc(var(--u)*2)}.lg img{height:54px}.lg b{font:800 calc(var(--u)*6) var(--mono);letter-spacing:-.03em}
.win{position:absolute;left:calc(var(--u)*7);top:calc(var(--u)*26);width:calc(var(--u)*104);background:#14121e;border:calc(var(--u)*.3) solid #3a3358}
.tb{height:calc(var(--u)*5);background:#1c192a;display:flex;align-items:center;gap:calc(var(--u)*1);padding:0 calc(var(--u)*2)}.tb i{width:calc(var(--u)*1.4);height:calc(var(--u)*1.4);background:#4a4468}
.bd{padding:calc(var(--u)*3.4);font:700 calc(var(--u)*3.7) var(--mono);line-height:1.55;white-space:nowrap}
.bd .c{color:var(--ok)}.bd .d{color:#8a84a8}.bd .o{color:var(--ok)}
.ch{display:flex;gap:calc(var(--u)*1.4);margin-top:calc(var(--u)*1.4)}.ch span{display:flex;align-items:center;gap:calc(var(--u)*.9);background:#07211a;border:calc(var(--u)*.2) solid #0b5a3f;padding:calc(var(--u)*.7) calc(var(--u)*1.2);color:var(--ok);font-size:calc(var(--u)*2.9)}.ch img{width:calc(var(--u)*3.8);height:calc(var(--u)*3.8);object-fit:contain}
.badge{position:absolute;right:calc(var(--u)*7);top:50%;transform:translateY(-52%);text-align:center}
.badge .n{font-weight:800;font-size:calc(var(--u)*34);letter-spacing:-.06em;line-height:.9;color:var(--ok)}
.badge .k{font:700 calc(var(--u)*3.6) var(--mono);color:#aaa;margin-top:calc(var(--u)*1.4)}.badge .o{font:700 calc(var(--u)*3.6) var(--mono);color:#ff5f5f;text-decoration:line-through;margin-bottom:calc(var(--u)*1)}
.ft{position:absolute;left:calc(var(--u)*7);bottom:calc(var(--u)*6);font:700 calc(var(--u)*3.8) var(--mono);color:var(--at)}`,
    html: `<div class="lg">${logo}<b>self-host</b></div>
<div class="win"><div class="tb"><i></i><i></i><i></i></div><div class="bd"><div><span class="c">$</span> curl -fsSL self-host.fyi/install | bash</div><div class="d">✓ self-host installed</div><div><span class="c">$</span> self-host install media homarr</div><div class="ch"><span>${ic("jellyfin")}✓ Jellyfin</span><span>${ic("sonarr")}✓ Sonarr</span><span>${ic("radarr")}✓ Radarr</span><span>${ic("homarr")}✓ Homarr</span></div></div></div>
<div class="badge"><div class="o">$92/mo rented</div><div class="n">$0</div><div class="k">per month, yours</div></div>
<div class="ft">93 Apps · 20 Recipes · 1 binary</div>` },
  { id: "dashprice", name: "Mix: dashboard bg + $92→$0 + hook + curl", css: `
.frame{background-image:url(frames/f-18.6.png);filter:blur(calc(var(--u)*.9)) brightness(.38) saturate(1.2);background-size:170%;background-position:70% 78%}
.wrap{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 calc(var(--u)*8);gap:calc(var(--u)*3.2)}
.lg{display:flex;align-items:center;gap:calc(var(--u)*2.2)}.lg img{height:54px}.lg b{font:800 calc(var(--u)*6) var(--mono);letter-spacing:-.03em}
.p{display:flex;align-items:baseline;gap:calc(var(--u)*3);font-weight:800;font-size:calc(var(--u)*22);letter-spacing:-.06em;line-height:.95}
.p s{color:#ff5f5f;text-decoration-thickness:calc(var(--u)*1.3)}.p i{font-style:normal;color:#777;font-size:.7em}.p b{color:var(--ok)}
.h{font-weight:800;font-size:calc(var(--u)*7.4);letter-spacing:-.035em;line-height:1}.h span{color:var(--at)}
.cmd{align-self:flex-start;background:#14121ecc;border:calc(var(--u)*.3) solid #3a3358;padding:calc(var(--u)*1.8) calc(var(--u)*2.8);font:700 calc(var(--u)*3.6) var(--mono);white-space:nowrap}.cmd i{font-style:normal;color:var(--ok)}
.bar{position:absolute;left:0;right:0;bottom:0;height:calc(var(--u)*1.6);background:var(--a)}`,
    html: `<div class="frame"></div><div class="wrap"><div class="lg">${logo}<b>self-host</b></div><div class="p"><s>$92</s><i>→</i><b>$0</b></div><div class="h">Your <span>Apps.</span> Your home. One binary.</div><div class="cmd"><i>$</i> curl -fsSL self-host.fyi/install | bash</div></div><div class="bar"></div>` },
];
for (const [i, v] of V.entries()) {
  writeFileSync(join(dir, `v${i + 1}-${v.id}.html`), `<!doctype html><meta charset=utf-8><style>${base}${v.css}</style>${v.html}`);
}
writeFileSync(join(dir, "variants.json"), JSON.stringify(V.map((v, i) => ({ n: i + 1, id: v.id, name: v.name })), null, 1));
const b = await chromium.launch();
for (const [i, v] of V.entries()) {
  for (const [w, h] of [[1280, 720], [1200, 630]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.goto("file://" + join(dir, `v${i + 1}-${v.id}.html`));
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: join(dir, `v${i + 1}-${v.id}-${w}x${h}.png`) });
    await p.close();
  }
}
await b.close();
