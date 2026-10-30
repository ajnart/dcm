import { REPO, githubToken } from "./version";

const [owner, repo] = REPO.split("/");
const token = githubToken();
const version = /^self-host (\d+)\.(\d+)\.(\d+)$/;

export const PAGE_SIZE = 10;

export const changelog = {
	provider: "github" as const,
	base: "docs/changelog",
	title: "Changelog",
	owner,
	repo,
	token,
	enabled: Boolean(token),
	pageSize: PAGE_SIZE,
	process: ({ title }: { title: string }) =>
		version.exec(title)?.slice(1).join("."),
};

export function rank(title: string): number {
	const [major, minor, patch] = title.split(".").map(Number);
	return -(major * 1e6 + minor * 1e3 + patch);
}

export type ChangelogPage = {
	title: string;
	crumb: string;
	description: string;
};

export function changelogPage(slug: string): ChangelogPage | undefined {
	if (slug === "docs/changelog")
		return {
			title: "Changelog",
			crumb: "Changelog",
			description:
				"Every self-host release: what was added, changed and fixed, newest first.",
		};
	const list = /^docs\/changelog\/(\d+)$/.exec(slug);
	if (list) {
		const title = `Changelog, page ${list[1]}`;
		return {
			title,
			crumb: title,
			description: `Older self-host releases, page ${list[1]} of the changelog: what was added, changed and fixed.`,
		};
	}
	const found =
		/^docs\/changelog\/version\/(\d+)-(\d+)-(\d+)(\.\.\.latest)?$/.exec(slug);
	if (!found) return undefined;
	const number = found.slice(1, 4).join(".");
	if (found[4])
		return {
			title: `Changes since ${number}`,
			crumb: `Since ${number}`,
			description: `Everything that changed in self-host from ${number} to the latest release, on one page.`,
		};
	return {
		title: `self-host ${number} release notes`,
		crumb: number,
		description: `What changed in self-host ${number}: the release notes with every addition and fix.`,
	};
}
