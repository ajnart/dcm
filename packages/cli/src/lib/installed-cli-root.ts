/** Bundled owners and app adapters share one installed runtime, irrespective
 * of which compiled entrypoint contains a source helper. No checkout fallback. */
export function installedCliRoot(moduleUrl: string): URL {
  const own = new URL(moduleUrl);
  if (/\/workflows\/selfhost\/references\/catalog\/apps\/[a-z0-9-]+\/[^/]+\.js$/.test(own.pathname)) {
    return new URL("../../../../../../", own);
  }
  if (own.pathname.endsWith("/workflows/selfhost-compose/scripts/pre-start-check.js")) return new URL("../../../", own);
  if (own.pathname.endsWith("/workflows/selfhost-compose/scripts/mutable-config.js")) return new URL("../../../", own);
  return new URL("./", own);
}
