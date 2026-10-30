import { AppCard } from "@/components/app-card";
import { routes } from "@/lib/routes";
import { useEffect, useState, useSyncExternalStore } from "react";
import { apps } from "../lib/catalog";
import { selection } from "../scripts/selection.js";

const PREVIEW = 24;
const pinned = [...apps].sort(
	(a, b) => Number(b.id === "homarr") - Number(a.id === "homarr"),
);
const picked = () => selection.ids().join(",");

interface SelectionEntry {
	id: string;
	appId: string;
	tags: string[];
}

export default function HomeCatalog({
	entries,
}: { entries: SelectionEntry[] }) {
	const [needle, setNeedle] = useState("");
	const [expanded, setExpanded] = useState(false);
	const chosen = new Set(
		useSyncExternalStore(selection.onChange, picked, () => "")
			.split(",")
			.filter(Boolean),
	);

	useEffect(() => selection.connect(entries), [entries]);

	const query = needle.toLowerCase().replace(/^\//, "").trim();
	const capped = !expanded && !query;
	const tags = new Map(
		entries.map((entry) => [entry.appId, entry.tags.join(" ")]),
	);
	const matches = pinned.filter((app) =>
		`${app.id} ${app.name} ${app.description} ${app.category} ${tags.get(app.id) ?? ""}`
			.toLowerCase()
			.includes(query),
	);
	const shown = capped ? matches.slice(0, PREVIEW) : matches;

	return (
		<>
			<input
				id="q"
				className="filter"
				type="search"
				placeholder="/ filter apps"
				aria-label="Filter Apps"
				autoComplete="off"
				spellCheck={false}
				value={needle}
				onChange={(e) => setNeedle(e.target.value)}
			/>
			<div className="appcard-grid" id="catalog">
				{shown.map((app) => (
					<div className="appcard-slot" key={app.id}>
						<AppCard
							name={app.name}
							description={app.description}
							icon={app.icon}
							stars={app.stars}
							repoUrl={app.repo ? `https://github.com/${app.repo}` : undefined}
							detailsHref={routes.app(app.id)}
							wires={app.links.length}
							selected={chosen.has(app.id)}
							onSelect={() => selection.toggle(app.id)}
						/>
					</div>
				))}
			</div>
			<p className="more-row">
				{capped && (
					<button
						className="btn more"
						id="more"
						type="button"
						onClick={() => setExpanded(true)}
					>
						Show all {apps.length} Apps
					</button>
				)}{" "}
				<a className="btn" href={routes.apps}>
					Browse every App
				</a>
			</p>
		</>
	);
}
