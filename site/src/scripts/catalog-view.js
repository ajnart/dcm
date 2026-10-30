import { track } from "../lib/analytics";
import { appById } from "../lib/catalog";
import { selection } from "./selection.js";
import { $, copy, iconEl, toast } from "./util.js";

function drawStack() {
	const stack = $("#stack");
	stack.replaceChildren();
	for (const id of selection.ids()) {
		const b = document.createElement("button");
		b.type = "button";
		b.title = `remove ${appById.get(id).name}`;
		b.append(iconEl(appById.get(id)));
		b.addEventListener("click", () => selection.remove(id));
		stack.append(b);
	}
}

function drawWires() {
	const box = $("#wires");
	const links = selection.links();
	const tiles = selection.dashboardCandidates();
	box.replaceChildren();
	if (links.length) {
		const head = document.createElement("b");
		head.textContent = `⇄ ${links.length} Link${links.length === 1 ? "" : "s"} wired for you`;
		box.append(head);
		const bySource = Map.groupBy(links, (l) => l.from);
		for (const [from, out] of bySource) {
			const group = document.createElement("span");
			group.className = "pair";
			group.title = out.map((l) => l.title).join("\n");
			const name = document.createElement("strong");
			name.textContent = appById.get(from).name;
			group.append(
				name,
				` → ${out.map((l) => appById.get(l.to).name).join(", ")}`,
			);
			box.append(group);
		}
	}
	if (tiles.length) {
		const hint = document.createElement("button");
		hint.type = "button";
		hint.className = "hint";
		hint.textContent = `+ add Homarr and these ${tiles.length} get tiles and widgets on one dashboard`;
		hint.addEventListener("click", () => selection.add(["homarr"]));
		box.append(hint);
	}
	box.hidden = !box.childElementCount;
}

export function mountCatalog({ onInstall, onSearch }) {
	const unselect = $("#unselect");

	const sync = () => {
		const n = selection.size;
		$("#selcount").textContent = `${n} App${n === 1 ? "" : "s"} selected`;
		for (const id of ["share", "unselect", "install-sel"])
			$(`#${id}`).disabled = n === 0;
		$("#selcmd").textContent = n
			? selection.installLine()
			: "self-host install …  (pick some Apps)";
		drawStack();
		drawWires();
	};

	const disarm = () => {
		unselect.classList.remove("danger");
		unselect.textContent = "unselect";
	};

	$("#share").addEventListener("click", async () => {
		const copied = await copy(selection.shareUrl());
		if (copied) track({ name: "share_link_copied", count: selection.size });
		toast(
			copied
				? "Share link copied. Whoever opens it gets these Apps picked."
				: selection.shareUrl(),
		);
	});
	unselect.addEventListener("click", () => {
		if (!unselect.classList.contains("danger")) {
			unselect.classList.add("danger");
			unselect.textContent = "u sure?";
			return;
		}
		disarm();
		selection.clear();
	});
	unselect.addEventListener("mouseleave", disarm);
	$("#install-sel").addEventListener("click", onInstall);
	$("#open-palette").addEventListener("click", onSearch);
	selection.onChange(sync);
	sync();
}
