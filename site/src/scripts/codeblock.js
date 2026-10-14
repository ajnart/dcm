import { copy } from "./util.js";

for (const select of document.querySelectorAll(".codeblock select.variant")) {
  select.addEventListener("change", () => {
    const block = select.closest(".codeblock");
    const pres = block?.querySelectorAll("pre[data-code]") ?? [];
    pres.forEach((pre, i) => (pre.hidden = i !== select.selectedIndex));
    const button = block?.querySelector("[data-copy]");
    if (button) button.dataset.copy = pres[select.selectedIndex]?.dataset.code ?? "";
  });
}

for (const button of document.querySelectorAll(".codeblock [data-copy]")) {
  button.addEventListener("click", async () => {
    const code = button.closest(".codeblock")?.querySelector("pre:not([hidden]) code");
    let ok = await copy(button.dataset.copy ?? "");
    if (!ok && code) {
      getSelection()?.selectAllChildren(code);
      ok = document.execCommand("copy");
    }
    button.textContent = ok ? "copied" : "select it";
    button.classList.toggle("done", ok);
    setTimeout(() => {
      button.textContent = "copy";
      button.classList.remove("done");
    }, 1500);
  });
}
