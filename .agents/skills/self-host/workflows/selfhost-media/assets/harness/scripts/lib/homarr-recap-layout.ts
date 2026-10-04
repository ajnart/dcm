const additionalTitle = "More services in your homelab";
const startMarker = "<!-- selfhost-additional-services:start -->";
const endMarker = "<!-- selfhost-additional-services:end -->";

/** Pure shared grid estimate; rendered desktop/mobile proof remains required. */
export function recapHeight(content: string, width: number): number {
  const visible = content.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ").trim();
  // This estimates grid size only; browser evidence remains the readability gate.
  // A three-column companion with about 810 visible characters fits in eight
  // rows in the live mobile layout; keep a two-row allowance for headings.
  let estimated = Math.max(8, Math.ceil(visible.length / (Math.max(1, width) * 140 / 3)) + 2);
  const headings = (content.match(/<h[1-6]\b/g) ?? []).length;
  // Heading-heavy primary recaps need an extra mobile row to avoid clipping.
  if (width < 6 && headings >= 4) estimated += 1;
  if (width < 6 && headings >= 5) estimated += 2;
  if (width >= 6) {
    let minimumHeight = 4;
    let headingAllowance = 3;
    if (headings >= 5) headingAllowance = 4;
    // Compact only short, adapter-owned desktop companions. Keep primary,
    // longer companion and mobile estimates unchanged until rendered proof.
    if (visible.length <= 800 && content.startsWith(`<h2>${additionalTitle}</h2>`)
      && content.includes(startMarker) && content.includes(endMarker)) {
      minimumHeight = 3;
      headingAllowance = 1;
    }
    estimated = Math.max(minimumHeight, Math.ceil(visible.length / (width * 500 / 8)) + headingAllowance);
  }
  // Homarr's item layout accepts at most 24 rows. A slightly conservative text
  // estimate must not prevent us from expanding an existing clipped Notebook.
  // Browser inspection remains the final readability check at this ceiling.
  if (estimated > 48) throw new Error(`Homarr Notebook needs about ${estimated} rows at width ${width}; split the recap before attachment`);
  return Math.min(estimated, 24);
}
