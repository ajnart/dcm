import Prism from "prismjs";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-yaml.js";

const highlight = (line, lang) => {
  const grammar = Prism.languages[lang];
  return grammar ? Prism.highlight(line, grammar, lang) : Prism.util.encode(line).toString();
};

const unprompted = (line, previous) => line.trim() === "" || line.trimStart().startsWith("#") || previous.trimEnd().endsWith("\\");

export function highlightLines(code, lang) {
  const lines = code.split("\n");
  return lines
    .map((line, i) => {
      const nop = lang === "bash" && unprompted(line, lines[i - 1] ?? "");
      return `<span class="line${nop ? " nop" : ""}">${highlight(line, lang)}</span>`;
    })
    .join("");
}

const aliases = { sh: "bash", shell: "bash" };
const entities = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&#x27;": "'" };
const decode = (html) => html.replace(/&(?:lt|gt|amp|quot|#39|#x27);/g, (e) => entities[e]);
const attr = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function codeblocks(html) {
  return html.replace(/<pre[^>]*><code(?: class="language-([\w-]+)")?[^>]*>([\s\S]*?)<\/code><\/pre>/g, (_, found = "text", body) => {
    const lang = aliases[found] ?? found;
    const source = decode(body).replace(/\n$/, "");
    return `<figure class="codeblock"><figcaption><span>${lang}</span><button class="copybtn" type="button" data-copy="${attr(source)}">copy</button></figcaption><pre class="language-${lang}"><code class="language-${lang}">${highlightLines(source, lang)}</code></pre></figure>`;
  });
}
