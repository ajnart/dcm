const still = new URLSearchParams(location.search).get("s") == "1";
fetch("section-links.json").then((r) => r.json()).then(({ variants }) => {
  const root = "../../../docs/assets/readme/";
  const kb = (b) => (b / 1024).toFixed(0) + " KB";
  const host = document.getElementById("sec-links");
  host.innerHTML = "<h2>Section: Apps that wire themselves (#565)</h2>" + variants.map((v, i) => {
    const [svg, png] = v.files;
    return `<div class="cap" id="links-${v.id}"><em>${i + 1}. ${v.name}</em> · ${v.desc}<br>svg <span class="${svg.bytes > svg.budget ? "over" : "ok"}">${kb(svg.bytes)}</span> · png fallback <span class="${png.bytes > png.budget ? "over" : "ok"}">${kb(png.bytes)}</span> / budget ${kb(svg.budget)} · <a href="${root}${png.file}">png</a> (<code>?s=1</code> shows the png)</div>
<div class="readme"><p align="center"><img src="${root}${still ? png.file : svg.file}" alt="${v.alt}" width="${v.w}"></p></div>`;
  }).join("");
  if (location.hash.startsWith("#links")) document.getElementById(location.hash.slice(1))?.scrollIntoView();
});
