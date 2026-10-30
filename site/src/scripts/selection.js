import { STORAGE_KEYS } from "@/lib/constants";
import { appById, expand, installLine, linksAmong } from "../lib/catalog";

const ids = new Set();
const listeners = new Set();
let appByEntry = new Map();
let entryByApp = new Map();

function storedIds() {
	try {
		const stored = JSON.parse(
			localStorage.getItem(STORAGE_KEYS.SELECTED_TOOLS) ?? "[]",
		);
		if (!Array.isArray(stored)) return [];
		return stored.filter((id) => typeof id === "string");
	} catch (error) {
		console.error("Could not load the saved App selection:", error);
		return [];
	}
}

const notify = () => listeners.forEach((fn) => fn());
const changed = () => {
	if (entryByApp.size) {
		const other = storedIds().filter((id) => !appByEntry.has(id));
		const picked = [...ids].flatMap((id) => entryByApp.get(id) ?? []);
		try {
			localStorage.setItem(
				STORAGE_KEYS.SELECTED_TOOLS,
				JSON.stringify([...other, ...picked]),
			);
		} catch (error) {
			console.error("Could not save the App selection:", error);
		}
	}
	notify();
};

export const selection = {
	connect(entries) {
		appByEntry = new Map(entries.map((entry) => [entry.id, entry.appId]));
		entryByApp = new Map(entries.map((entry) => [entry.appId, entry.id]));
		const restore = () => {
			ids.clear();
			for (const entryId of storedIds()) {
				const appId = appByEntry.get(entryId);
				if (appId) ids.add(appId);
			}
			notify();
		};
		const params = new URLSearchParams(location.search);
		if (params.has("apps")) {
			ids.clear();
			for (const id of expand(params.get("apps").split(",")).ids) ids.add(id);
			changed();
		} else {
			restore();
		}
		const onStorage = (event) => {
			if (event.key === STORAGE_KEYS.SELECTED_TOOLS || event.key === null)
				restore();
		};
		const onPageShow = (event) => {
			if (event.persisted) restore();
		};
		window.addEventListener("storage", onStorage);
		window.addEventListener("pageshow", onPageShow);
		return () => {
			window.removeEventListener("storage", onStorage);
			window.removeEventListener("pageshow", onPageShow);
		};
	},
	onChange(fn) {
		listeners.add(fn);
		return () => listeners.delete(fn);
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
	installLine: () => installLine(ids),
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
		const homarr = appById.get("homarr");
		return [...ids].filter((id) => homarr.links.some((l) => l.to === id));
	},
};
