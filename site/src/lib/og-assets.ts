import { basename, parse } from "node:path";
import sharp from "sharp";
import installSearch from "../../../docs/images/install-search.png?inline";
import frameServers from "../../../video/reel/thumbs/frames/f-5.6.png?inline";
import frameLinks from "../../../video/reel/thumbs/frames/f-15.2.png?inline";
import frameAgents from "../../../video/reel/thumbs/frames/f-25.5.png?inline";
import heroCommand from "../../public/images/readme/hero-command.svg?raw";

export type ImageName = "servers" | "links" | "agents" | "install" | "command";

type Source = { bytes: Buffer; width: number; height: number };

const decode = (uri: string): Buffer => {
	const separator = uri.indexOf(",");
	const body = uri.slice(separator + 1);
	if (uri.slice(0, separator).endsWith(";base64"))
		return Buffer.from(body, "base64");
	return Buffer.from(decodeURIComponent(body));
};

const IMAGES: Record<ImageName, Source> = {
	servers: { bytes: decode(frameServers), width: 1920, height: 1080 },
	links: { bytes: decode(frameLinks), width: 1920, height: 1080 },
	agents: { bytes: decode(frameAgents), width: 1920, height: 1080 },
	install: { bytes: decode(installSearch), width: 1124, height: 580 },
	command: { bytes: Buffer.from(heroCommand), width: 1173, height: 320 },
};

const bundled = new Map(
	Object.entries(
		import.meta.glob<string>("../../../video/reel/assets/icons/*.{png,svg}", {
			eager: true,
			query: "?inline",
			import: "default",
		}),
	).map(([file, source]) => [parse(file).name, source]),
);
const localIcons = import.meta.glob<string>(
	"../../public/images/containers/*.{png,svg}",
	{ eager: true, query: "?inline", import: "default" },
);
const ICON_PX = 192;

const toDataUri = (png: Buffer): string =>
	`data:image/png;base64,${png.toString("base64")}`;

export type Picture = { href: string; width: number; height: number };

const pictures = new Map<string, Promise<Picture>>();

export function picture(name: ImageName, width: number): Promise<Picture> {
	const key = `${name}:${width}`;
	const cached = pictures.get(key);
	if (cached) return cached;
	const { bytes, width: w, height: h } = IMAGES[name];
	const height = Math.round((width * h) / w);
	const made = sharp(bytes, { density: 192 })
		.resize(width * 2, height * 2)
		.png()
		.toBuffer()
		.then((png) => ({ href: toDataUri(png), width, height }));
	pictures.set(key, made);
	return made;
}

async function rasterised(
	url: string | undefined,
	name: string,
): Promise<string | undefined> {
	const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
	let source = bundled.get(`${id}-light`) ?? bundled.get(id);
	if (!source && url) source = bundled.get(parse(basename(url)).name);
	if (!source && url) source = localIcons[`../../public${url}`];
	if (!source) return undefined;
	const png = await sharp(decode(source), { density: 300 })
		.resize(ICON_PX, ICON_PX, {
			fit: "contain",
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png()
		.toBuffer();
	return toDataUri(png);
}

const icons = new Map<string, Promise<string | undefined>>();

export function iconImage(
	url: string | undefined,
	name = "",
): Promise<string | undefined> {
	const key = `${url ?? ""}:${name}`;
	const cached = icons.get(key);
	if (cached) return cached;
	const icon = rasterised(url, name);
	icons.set(key, icon);
	return icon;
}
