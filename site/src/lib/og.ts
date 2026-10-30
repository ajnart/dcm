import sharp from "sharp";
import logo from "../../public/logo.svg?raw";
import { type ImageName, iconImage, picture } from "./og-assets";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export type ServiceIcon = { name: string; icon?: string };

export type Art =
	| { kind: "image"; name: ImageName; width?: number }
	| { kind: "grid"; services: ServiceIcon[] }
	| { kind: "yaml" }
	| { kind: "suggest" }
	| { kind: "telemetry" };

export type Card =
	| {
			kind: "app";
			slug: string;
			name: string;
			description: string;
			category: string;
			stars: number;
			command: string;
			icon?: string;
	  }
	| {
			kind: "stack";
			slug: string;
			label: string;
			title: string;
			description: string;
			chips: string[];
			services: ServiceIcon[];
			docs?: boolean;
	  }
	| {
			kind: "page";
			slug: string;
			label: string;
			title: string;
			subtitle: string;
			art?: Art;
			docs?: boolean;
	  }
	| {
			kind: "release";
			slug: string;
			version: string;
			date?: string;
			headline?: string;
	  };

const FONT = "JetBrains Mono, SF Mono, Menlo, DejaVu Sans Mono, monospace";
const COLORS = {
	bg: "#1e1d2a",
	deep: "#171621",
	panel: "#23222f",
	line: "#3a3947",
	ink: "#e4e4ea",
	muted: "#8a8a96",
	accent: "#7a57d3",
	accentText: "#a88df2",
	selected: "#2b2140",
	info: "#5fafff",
	ok: "#00d787",
	warn: "#ffaf00",
	fail: "#ff5f5f",
};
const GLYPH = 0.6;
const LEFT = 80;
const RIGHT = 1120;

export const pageSlug = (pathname: string): string =>
	pathname.replace(/\.html$/, "").replace(/^\/+|\/+$/g, "") || "index";

export const ogPath = (pathname: string): string =>
	`/og/${pageSlug(pathname)}.png`;

const xmlText = (text: string): string =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

function wrap(text: string, width: number, lines: number): string[] {
	const out: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const next = line ? `${line} ${word}` : word;
		if (next.length <= width) {
			line = next;
			continue;
		}
		if (line) out.push(line);
		line = word.length > width ? `${word.slice(0, width - 1)}…` : word;
	}
	if (line) out.push(line);
	if (out.length <= lines) return out;
	const kept = out.slice(0, lines);
	kept[lines - 1] =
		`${kept[lines - 1].slice(0, width - 1).replace(/\s+\S*$/, "")}…`;
	return kept;
}

function fitLine(
	text: string,
	width: number,
	sizes: number[],
): { size: number; text: string } {
	const size =
		sizes.find((s) => text.length * s * GLYPH <= width) ??
		sizes[sizes.length - 1];
	const max = Math.floor(width / (size * GLYPH));
	return {
		size,
		text: text.length <= max ? text : `${text.slice(0, max - 1)}…`,
	};
}

const logoShapes = logo
	.split("\n")
	.map((line) => line.trim())
	.filter((line) => /^<(rect|circle)\b/.test(line))
	.join("");

type TextOptions = {
	size: number;
	fill: string;
	weight?: number;
	anchor?: "middle" | "end";
};

const text = (
	x: number,
	y: number,
	body: string,
	{ size, fill, weight = 400, anchor }: TextOptions,
) =>
	`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor ? ` text-anchor="${anchor}"` : ""}>${xmlText(body)}</text>`;

const star = (cx: number, cy: number, r: number): string => {
	const points = Array.from({ length: 10 }, (_, i) => {
		const angle = (-90 + i * 36) * (Math.PI / 180);
		const radius = i % 2 === 0 ? r : r * 0.42;
		return `${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`;
	});
	return `<polygon points="${points.join(" ")}" fill="${COLORS.warn}"/>`;
};

const CHIP = { size: 24, height: 44, pad: 20, star: 36 };

function chip(
	x: number,
	y: number,
	label: string,
	tone: "accent" | "plain" | "star",
) {
	const lead = tone === "star" ? CHIP.star : 0;
	const width = CHIP.pad * 2 + lead + label.length * CHIP.size * GLYPH;
	const fill = tone === "accent" ? COLORS.selected : COLORS.panel;
	const stroke = tone === "accent" ? COLORS.accent : COLORS.line;
	const ink = tone === "accent" ? COLORS.accentText : COLORS.ink;
	const mark =
		tone === "star" ? star(x + CHIP.pad + 10, y + CHIP.height / 2, 11) : "";
	return {
		width,
		svg: `<rect x="${x}" y="${y}" width="${width}" height="${CHIP.height}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>${mark}${text(x + CHIP.pad + lead, y + 31, label, { size: CHIP.size, fill: ink })}`,
	};
}

function chipRow(
	x: number,
	y: number,
	chips: { label: string; tone: "accent" | "plain" | "star" }[],
): string {
	let cursor = x;
	return chips
		.map(({ label, tone }) => {
			const placed = chip(cursor, y, label, tone);
			cursor += placed.width + 16;
			return placed.svg;
		})
		.join("");
}

function tile(
	x: number,
	y: number,
	size: number,
	icon: string | undefined,
	letter: string,
): string {
	const frame = `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${COLORS.panel}" stroke="${COLORS.line}" stroke-width="2"/>`;
	if (icon) {
		const pad = Math.round(size * 0.14);
		return `${frame}<image href="${icon}" x="${x + pad}" y="${y + pad}" width="${size - pad * 2}" height="${size - pad * 2}"/>`;
	}
	return `${frame}${text(x + size / 2, y + size / 2 + size * 0.18, letter, { size: size * 0.5, fill: COLORS.accentText, weight: 800, anchor: "middle" })}`;
}

const urlLine = (slug: string): string => {
	const line = fitLine(
		`self-host.fyi${slug === "index" ? "" : `/${slug}`}`,
		RIGHT - LEFT,
		[24, 22, 20],
	);
	return text(LEFT, 596, line.text, { size: line.size, fill: COLORS.info });
};

type Frame = { brand: string; label: string; logo: "big" | "small" };

const BIG_LOGO = `<g transform="translate(905 330) scale(1.05)">${logoShapes}</g>`;
const SMALL_LOGO = `<g transform="translate(1066 80) scale(.25)">${logoShapes}</g>`;

function scaffold({ brand, label, logo: size }: Frame, body: string): string {
	const badge = 32 + (brand.length + 2) * 18;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="${COLORS.deep}" stroke-width="2"/></pattern></defs>
  <rect width="100%" height="100%" fill="${COLORS.bg}"/>
  <rect width="100%" height="100%" fill="url(#grid)"/>
  <rect x="0" y="0" width="${OG_WIDTH}" height="8" fill="${COLORS.accent}"/>
  <rect x="${LEFT}" y="84" width="${badge}" height="48" fill="${COLORS.accent}"/>
  ${text(LEFT + 16, 118, `◆ ${brand}`, { size: 30, fill: "#f5f5f5", weight: 800 })}
  ${text(LEFT + badge + 24, 118, label, { size: 30, fill: COLORS.muted })}
  ${size === "big" ? BIG_LOGO : SMALL_LOGO}
  ${body}
</svg>`;
}

async function renderApp(
	card: Extract<Card, { kind: "app" }>,
): Promise<string> {
	const icon = await iconImage(card.icon, card.slug.slice("apps/".length));
	const name = fitLine(card.name, RIGHT - 280, [76, 64, 56]);
	const description = wrap(
		card.description,
		Math.floor((RIGHT - LEFT) / (32 * GLYPH)),
		2,
	);
	const chips: { label: string; tone: "accent" | "plain" | "star" }[] = [
		{ label: card.category, tone: "accent" },
	];
	if (card.stars > 0)
		chips.push({ label: starLabel(card.stars), tone: "star" });
	const command = `$ ${card.command}`;
	const commandWidth = 56 + command.length * 30 * GLYPH;
	const body = `${tile(LEFT, 168, 168, icon, card.name[0])}
  ${text(280, 192 + name.size * 0.78, name.text, { size: name.size, fill: COLORS.ink, weight: 800 })}
  ${chipRow(280, 292, chips)}
  ${description.map((line, i) => text(LEFT, 396 + i * 44, line, { size: 32, fill: COLORS.muted })).join("")}
  <rect x="${LEFT}" y="478" width="${commandWidth}" height="68" fill="${COLORS.deep}" stroke="${COLORS.line}" stroke-width="2"/>
  ${text(LEFT + 28, 522, "$", { size: 30, fill: COLORS.ok, weight: 800 })}
  ${text(LEFT + 28 + 2 * 30 * GLYPH, 522, card.command, { size: 30, fill: COLORS.ink })}
  ${urlLine(card.slug)}`;
	return scaffold({ brand: "self-host", label: "apps", logo: "small" }, body);
}

const TILE = 96;
const TILE_GAP = 16;
const TILE_MAX = 9;

async function renderStack(
	card: Extract<Card, { kind: "stack" }>,
): Promise<string> {
	const shown =
		card.services.length > TILE_MAX ? TILE_MAX - 1 : card.services.length;
	const icons = await Promise.all(
		card.services
			.slice(0, shown)
			.map((service) => iconImage(service.icon, service.name)),
	);
	const title = fitLine(card.title, RIGHT - LEFT, [72, 64, 56, 48]);
	const description = wrap(
		card.description,
		Math.floor((RIGHT - LEFT) / (30 * GLYPH)),
		2,
	);
	const tiles = icons.map((icon, i) => {
		const x = LEFT + i * (TILE + TILE_GAP);
		const name = fitLine(card.services[i].name, TILE, [18, 16, 14]);
		return `${tile(x, 432, TILE, icon, card.services[i].name[0])}${text(x + TILE / 2, 554, name.text, { size: name.size, fill: COLORS.muted, anchor: "middle" })}`;
	});
	if (shown < card.services.length) {
		const x = LEFT + shown * (TILE + TILE_GAP);
		tiles.push(
			`<rect x="${x}" y="432" width="${TILE}" height="${TILE}" fill="${COLORS.selected}" stroke="${COLORS.accent}" stroke-width="2"/>${text(x + TILE / 2, 432 + TILE / 2 + 12, `+${card.services.length - shown}`, { size: 32, fill: COLORS.accentText, weight: 800, anchor: "middle" })}`,
		);
	}
	const body = `${text(LEFT, 168 + title.size * 0.75, title.text, { size: title.size, fill: COLORS.ink, weight: 800 })}
  ${description.map((line, i) => text(LEFT, 272 + i * 42, line, { size: 30, fill: COLORS.muted })).join("")}
  ${chipRow(
		LEFT,
		340,
		card.chips.map((label, i) => ({
			label,
			tone: i === 0 ? "accent" : "plain",
		})),
	)}
  ${tiles.join("")}
  ${urlLine(card.slug)}`;
	return scaffold(
		{
			brand: card.docs ? "self-host docs" : "self-host",
			label: card.label,
			logo: "small",
		},
		body,
	);
}

const frameRect = (
	x: number,
	y: number,
	w: number,
	h: number,
	fill = COLORS.deep,
) =>
	`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${COLORS.line}" stroke-width="2"/>`;

const YAML: [indent: number, key: string, value?: string][] = [
	[0, "services"],
	[1, "jellyfin"],
	[2, "image", "jellyfin/jellyfin"],
	[2, "ports", '["8096:8096"]'],
	[1, "sonarr"],
	[2, "image", "linuxserver/sonarr"],
	[1, "radarr"],
];

function yamlPanel(
	x: number,
	y: number,
	w: number,
): { svg: string; height: number } {
	const step = 34;
	const height = 64 + YAML.length * step + 20;
	const lines = YAML.map(([indent, key, value], i) => {
		const lx = x + 28 + indent * 24;
		const ly = y + 64 + 24 + i * step;
		const keyWidth = (key.length + 1) * 24 * GLYPH;
		const val = value
			? text(lx + keyWidth + 24 * GLYPH, ly, value, {
					size: 24,
					fill: COLORS.ink,
				})
			: "";
		return `${text(lx, ly, `${key}:`, { size: 24, fill: COLORS.info })}${val}`;
	});
	const dots = [COLORS.fail, COLORS.warn, COLORS.ok]
		.map(
			(fill, i) =>
				`<circle cx="${x + 28 + i * 26}" cy="${y + 30}" r="8" fill="${fill}"/>`,
		)
		.join("");
	return {
		height,
		svg: `${frameRect(x, y, w, height)}${dots}${text(x + 126, y + 38, "docker-compose.yml", { size: 22, fill: COLORS.muted })}<path d="M${x} ${y + 60}H${x + w}" stroke="${COLORS.line}" stroke-width="2"/>${lines.join("")}`,
	};
}

function suggestPanel(
	x: number,
	y: number,
	w: number,
): { svg: string; height: number } {
	const height = 280;
	const cx = x + w / 2;
	return {
		height,
		svg: `<rect x="${x}" y="${y}" width="${w}" height="${height}" fill="${COLORS.deep}" stroke="${COLORS.accent}" stroke-width="3" stroke-dasharray="14 10"/>
    <rect x="${cx - 6}" y="${y + 52}" width="12" height="72" fill="${COLORS.accentText}"/><rect x="${cx - 36}" y="${y + 82}" width="72" height="12" fill="${COLORS.accentText}"/>
    ${text(cx, y + 182, "Missing an app?", { size: 32, fill: COLORS.ink, weight: 800, anchor: "middle" })}
    ${text(cx, y + 226, "Ask an agent or open an issue", { size: 22, fill: COLORS.muted, anchor: "middle" })}`,
	};
}

const SENT = [
	"onboarding summary",
	"errors",
	"App requests",
	"feedback you approve",
];

function telemetryPanel(
	x: number,
	y: number,
	w: number,
): { svg: string; height: number } {
	const height = 64 + SENT.length * 46 + 76;
	const rows = SENT.map(
		(item, i) =>
			`${text(x + 32, y + 64 + 36 + i * 46, "✓", { size: 28, fill: COLORS.ok, weight: 800 })}${text(x + 76, y + 64 + 36 + i * 46, item, { size: 28, fill: COLORS.ink })}`,
	);
	const footY = y + 64 + SENT.length * 46 + 20;
	return {
		height,
		svg: `${frameRect(x, y, w, height)}${text(x + 28, y + 40, "what is sent", { size: 24, fill: COLORS.muted })}<path d="M${x} ${y + 60}H${x + w}" stroke="${COLORS.line}" stroke-width="2"/>${rows.join("")}<path d="M${x} ${footY}H${x + w}" stroke="${COLORS.line}" stroke-width="2"/>${text(x + 28, footY + 42, "success sends nothing", { size: 24, fill: COLORS.muted })}`,
	};
}

const GRID = { columns: 4, rows: 3, size: 96, gap: 16 };

async function gridPanel(
	x: number,
	y: number,
	services: ServiceIcon[],
): Promise<{ svg: string; height: number }> {
	const slots = GRID.columns * GRID.rows;
	const loaded = await Promise.all(
		services
			.slice(0, slots)
			.map((service) => iconImage(service.icon, service.name)),
	);
	const tiles = loaded.map((icon, i) =>
		tile(
			x + (i % GRID.columns) * (GRID.size + GRID.gap),
			y + Math.floor(i / GRID.columns) * (GRID.size + GRID.gap),
			GRID.size,
			icon,
			services[i].name[0],
		),
	);
	return {
		svg: tiles.join(""),
		height: GRID.rows * GRID.size + (GRID.rows - 1) * GRID.gap,
	};
}

const GRID_WIDTH = GRID.columns * GRID.size + (GRID.columns - 1) * GRID.gap;

async function drawArt(
	art: Art,
	centerY: number,
): Promise<{ svg: string; width: number }> {
	if (art.kind === "grid") {
		const x = RIGHT - GRID_WIDTH;
		const panel = await gridPanel(
			x,
			centerY - (GRID.rows * GRID.size + (GRID.rows - 1) * GRID.gap) / 2,
			art.services,
		);
		return { svg: panel.svg, width: GRID_WIDTH };
	}
	if (art.kind === "image") {
		const width = art.width ?? 480;
		const pic = await picture(art.name, width);
		const x = RIGHT - width;
		const y = centerY - pic.height / 2;
		return {
			width,
			svg: `<image href="${pic.href}" x="${x}" y="${y}" width="${width}" height="${pic.height}"/><rect x="${x}" y="${y}" width="${width}" height="${pic.height}" fill="none" stroke="${COLORS.line}" stroke-width="2"/>`,
		};
	}
	const width = 480;
	const x = RIGHT - width;
	const panels = {
		yaml: yamlPanel,
		suggest: suggestPanel,
		telemetry: telemetryPanel,
	};
	const make = panels[art.kind];
	const guess = make(x, 0, width).height;
	return { width, svg: make(x, centerY - guess / 2, width).svg };
}

async function renderPage(
	card: Extract<Card, { kind: "page" }>,
): Promise<string> {
	const art = card.art ? await drawArt(card.art, 330) : undefined;
	const column = art ? RIGHT - LEFT - art.width - 48 : 780;
	const title = [64, 56, 48]
		.map((size) => ({
			size,
			lines: wrap(card.title, Math.floor(column / (size * GLYPH)), 3),
		}))
		.find((option) => option.lines.length <= 2) ?? {
		size: 48,
		lines: wrap(card.title, Math.floor(column / (48 * GLYPH)), 3),
	};
	const step = Math.round(title.size * 1.2);
	const titleTop = 168 + title.size * 0.78;
	const subtitleTop = titleTop + (title.lines.length - 1) * step + 60;
	const subtitle = wrap(
		card.subtitle,
		Math.floor(column / (28 * GLYPH)),
		art ? 5 : 4,
	);
	const body = `${title.lines.map((line, i) => text(LEFT, titleTop + i * step, line, { size: title.size, fill: COLORS.ink, weight: 800 })).join("")}
  ${subtitle.map((line, i) => text(LEFT, subtitleTop + i * 40, line, { size: 28, fill: COLORS.muted })).join("")}
  ${art?.svg ?? ""}
  ${urlLine(card.slug)}`;
	return scaffold(
		{
			brand: card.docs ? "self-host docs" : "self-host",
			label: card.label,
			logo: art ? "small" : "big",
		},
		body,
	);
}

function renderRelease(card: Extract<Card, { kind: "release" }>): string {
	const version = fitLine(card.version, 760, [168, 144, 120]);
	const headline = card.headline ? wrap(card.headline, 40, 2) : [];
	const date = card.date ? `Released ${card.date}` : "Release notes";
	const body = `${text(LEFT, 214, "self-host", { size: 40, fill: COLORS.muted })}
  ${text(LEFT, 214 + version.size * 0.8, version.text, { size: version.size, fill: COLORS.accentText, weight: 800 })}
  ${text(LEFT, 214 + version.size * 0.8 + 64, date, { size: 32, fill: COLORS.ink })}
  ${headline.map((line, i) => text(LEFT, 214 + version.size * 0.8 + 114 + i * 42, line, { size: 30, fill: COLORS.muted })).join("")}
  ${urlLine(card.slug)}`;
	return scaffold(
		{ brand: "self-host docs", label: "docs / changelog", logo: "big" },
		body,
	);
}

export function starLabel(stars: number): string {
	if (stars >= 1000) return `${(stars / 1000).toFixed(1)}k`;
	return String(stars);
}

export async function renderCard(card: Card): Promise<Buffer> {
	let svg: string;
	switch (card.kind) {
		case "app":
			svg = await renderApp(card);
			break;
		case "stack":
			svg = await renderStack(card);
			break;
		case "page":
			svg = await renderPage(card);
			break;
		case "release":
			svg = renderRelease(card);
			break;
	}
	return sharp(Buffer.from(svg)).png().toBuffer();
}
