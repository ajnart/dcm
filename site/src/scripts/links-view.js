import { appById } from "../lib/catalog";
import { $, iconEl } from "./util.js";

const FEATURED = [
  ["sonarr", ["qbittorrent"], "Adds qBittorrent as Sonarr's download client, with its admin login."],
  ["prowlarr", ["sonarr", "radarr"], "Syncs Prowlarr's indexers to Sonarr and Radarr with their API keys."],
  ["seerr", ["jellyfin", "sonarr", "radarr"], "Requests from Seerr land in Sonarr and Radarr; Jellyfin is its media server."],
  ["homarr", ["jellyfin", "sonarr", "radarr"], "Homarr gets a tile and live widgets for each App it supports."],
];

function face(id) {
  const app = appById.get(id);
  const el = document.createElement("span");
  el.className = "lface";
  el.title = app.name;
  el.append(iconEl(app));
  return el;
}

function linkCard([from, targets, text], onTry) {
  const card = document.createElement("article");
  card.className = "linkcard";
  const wire = document.createElement("div");
  wire.className = "lwire";
  const line = document.createElement("span");
  line.className = "lline";
  const ends = document.createElement("span");
  ends.className = "lends";
  ends.append(...targets.map(face));
  wire.append(face(from), line, ends);

  const names = document.createElement("p");
  names.className = "lnames";
  names.textContent = `${appById.get(from).name} → ${targets.map((t) => appById.get(t).name).join(", ")}`;
  const what = document.createElement("p");
  what.className = "lwhat";
  what.textContent = text;

  const ids = [from, ...targets];
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.textContent = "Try these Apps";
  button.addEventListener("click", () => onTry(ids));
  card.append(wire, names, what, button);
  return card;
}

export function mountLinks({ onTry }) {
  $("#linkcards").append(...FEATURED.map((f) => linkCard(f, onTry)));
}
