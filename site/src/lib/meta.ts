export const ORIGIN = "https://self-host.fyi";

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;

export const fit = (max: number, ...options: string[]): string =>
	options.find((option) => option.length <= max) ?? options[options.length - 1];

export const schema = (...nodes: Record<string, unknown>[]) => ({
	"@context": "https://schema.org",
	"@graph": nodes,
});

export const breadcrumbs = (...trail: [name: string, path: string][]) => ({
	"@type": "BreadcrumbList",
	itemListElement: trail.map(([name, path], i) => ({
		"@type": "ListItem",
		position: i + 1,
		name,
		item: `${ORIGIN}${path}`,
	})),
});
