const sameSitePages = {
  and: [
    { href_matches: "/*" },
    { not: { href_matches: "/*.txt" } },
    { not: { href_matches: "/*.xml" } },
    { not: { href_matches: "/*.json" } },
    { not: { href_matches: "/*.mp4" } },
  ],
};

export const SPECULATION_RULES = JSON.stringify({
  prefetch: [{ source: "document", where: sameSitePages, eagerness: "immediate" }],
  prerender: [{ source: "document", where: sameSitePages, eagerness: "eager" }],
});
