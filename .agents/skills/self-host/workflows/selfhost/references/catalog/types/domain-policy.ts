import { parse } from "tldts";

/** Pinned PSL (ICANN + private section) and IANA special-use detection.
 * Unknown suffixes, bare suffixes and special-use descendants fail closed.
 * This classifies cookie scope, not domain ownership or client DNS/trust. */
export function isPublicOrSpecialSuffix(domain: string): boolean {
  if (typeof domain !== "string" || domain.length > 253
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) return true;
  const result = parse(domain, { allowPrivateDomains: true, detectSpecialUse: true });
  return result.hostname !== domain || result.isIp !== false
    || result.isSpecialUse !== false || result.domain === null
    || (result.isIcann !== true && result.isPrivate !== true);
}
