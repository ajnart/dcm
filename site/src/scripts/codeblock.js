import { track } from "../lib/analytics";
import { copy } from "./util.js";

const trackCopy = (block) => {
  const kind = block?.dataset.track;
  const id = block?.dataset.trackId ?? "";
  if (kind === "install") {
    const method = block.querySelector("select.variant option:checked")?.dataset.method;
    if (method) track({ name: "install_command_copied", method });
  }
  if (kind === "app") track({ name: "app_install_copied", app: id });
  if (kind === "recipe") track({ name: "recipe_install_copied", recipe: id });
};

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
    if (ok) trackCopy(button.closest(".codeblock"));
    button.textContent = ok ? "copied" : "select it";
    button.classList.toggle("done", ok);
    setTimeout(() => {
      button.textContent = "copy";
      button.classList.remove("done");
    }, 1500);
  });
}
