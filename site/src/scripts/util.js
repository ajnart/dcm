export const $ = (sel) => document.querySelector(sel);

export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

export const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

export async function waitFor(check, ms = 15000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
}

export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export const pad = (s, n) => String(s).padEnd(n);

const ICONS = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/";

export function iconEl(app) {
  const box = document.createElement("span");
  box.className = "ico";
  box.textContent = app.name[0];
  if (!app.i) return box;
  const img = new Image();
  img.alt = "";
  img.width = 22;
  img.height = 22;
  img.src = ICONS + app.i;
  img.addEventListener("load", () => box.replaceChildren(img));
  return box;
}

let toastTimer = 0;

export function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
