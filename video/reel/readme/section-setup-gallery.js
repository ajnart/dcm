fetch("section-setup.json").then((r) => r.json()).then(({ variants }) => {
  const root = "../../../docs/assets/readme/";
  const host = document.getElementById("setup");
  const kb = (b) => (b / 1024).toFixed(0) + " KB";
  const draw = () => {
    host.innerHTML = variants.map((v) => {
      const [svg, png] = v.files;
      const size = (f) => `<span class="${f.bytes > f.budget ? "over" : "ok"}">${f.file} ${kb(f.bytes)} / ${kb(f.budget)}</span>`;
      return `<h2>#564 section "30 seconds setup": ${v.name}</h2>
<div class="cap" style="margin:0 0 8px;width:auto">${v.desc} · ${size(svg)} · ${size(png)}</div>
<div class="readme" style="padding:32px;margin-bottom:16px"><p style="text-align:center"><img src="${root}${svg.file}" alt="${v.alt}" width="${v.w}"></p></div>
<details><summary class="cap" style="width:auto">static fallback (${png.file}) and alt text</summary><img src="${root}${png.file}" width="${v.w / 2}"><p class="cap" style="width:auto;margin:8px 0 0">${v.alt}</p></details>`;
    }).join("");
  };
  draw();
}).catch(() => {});
