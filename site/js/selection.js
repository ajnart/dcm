import { byId, expand, linksAmong } from "./project.js";

const ids = new Set();
const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());

export const selection = {
  onChange(fn) {
    listeners.add(fn);
  },
  has: (id) => ids.has(id),
  ids: () => [...ids],
  get size() {
    return ids.size;
  },
  toggle(id) {
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    changed();
  },
  add(targets) {
    for (const id of expand(targets).ids) ids.add(id);
    changed();
  },
  remove(id) {
    ids.delete(id);
    changed();
  },
  clear() {
    ids.clear();
    changed();
  },
  installLine: () => `self-host install ${[...ids].join(" ")}`,
  shareUrl() {
    const url = new URL(location.href);
    url.search = "";
    url.hash = "play";
    if (ids.size) url.searchParams.set("apps", [...ids].join(","));
    return url.toString();
  },
  links: () => linksAmong(ids),
  dashboardCandidates() {
    if (ids.has("homarr")) return [];
    const homarr = byId.get("homarr");
    return [...ids].filter((id) => homarr.l.includes(id));
  },
};
