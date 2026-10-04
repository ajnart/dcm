/** Extract only the generated SABnzbd API key from the [misc] INI section. */
export const SABNZBD_API_KEY_AWK = [
  'BEGIN { count = 0; key = "" }',
  '/^[[:space:]]*\\[misc\\][[:space:]]*$/ { in_misc = 1; next }',
  '/^[[:space:]]*\\[/ { in_misc = 0 }',
  'in_misc && /^[[:space:]]*api_key[[:space:]]*=/ {',
  '  value = $0',
  '  sub(/^[^=]*=[[:space:]]*/, "", value)',
  '  sub(/[[:space:]]*$/, "", value)',
  '  key = value',
  '  count++',
  '}',
  'END { if (count != 1) exit 2; print key }',
].join("\n");

/** Read only settings needed to trust the pinned private first-run route. */
export const SABNZBD_SETUP_SAFETY_AWK = [
  'BEGIN { api_count = 0; level_count = 0; exposure_count = 0; html_count = 0 }',
  '/^[[:space:]]*\\[misc\\][[:space:]]*$/ { section = "misc"; next }',
  '/^[[:space:]]*\\[logging\\][[:space:]]*$/ { section = "logging"; next }',
  '/^[[:space:]]*\\[/ { section = "" }',
  'section == "misc" && /^[[:space:]]*api_logging[[:space:]]*=/ {',
  '  api = $0; sub(/^[^=]*=[[:space:]]*/, "", api); sub(/[[:space:]]*$/, "", api); api_count++',
  '}',
  'section == "misc" && /^[[:space:]]*inet_exposure[[:space:]]*=/ {',
  '  exposure = $0; sub(/^[^=]*=[[:space:]]*/, "", exposure); sub(/[[:space:]]*$/, "", exposure); exposure_count++',
  '}',
  'section == "misc" && /^[[:space:]]*html_login[[:space:]]*=/ {',
  '  html = $0; sub(/^[^=]*=[[:space:]]*/, "", html); sub(/[[:space:]]*$/, "", html); html_count++',
  '}',
  'section == "logging" && /^[[:space:]]*log_level[[:space:]]*=/ {',
  '  level = $0; sub(/^[^=]*=[[:space:]]*/, "", level); sub(/[[:space:]]*$/, "", level); level_count++',
  '}',
  'END { if (api_count != 1 || level_count != 1 || exposure_count != 1 || html_count != 1) exit 2; print api; print level; print exposure; print html }',
].join("\n");

export function assertSabnzbdSetupSafety(raw: string): void {
  const fields = raw.trim().split(/\r?\n/);
  if (fields.length !== 4
    || !/^(?:0|1|true|false)$/i.test(fields[0])
    || !/^(?:-1|0|1|2)$/.test(fields[1])
    || !/^[0-5]$/.test(fields[2])
    || !/^(?:0|1|true|false)$/i.test(fields[3])) {
    throw new Error("SABnzbd private setup settings could not be verified before credential submission");
  }
  // SABnzbd 5.1.3's secured_expose logs request kwargs at DEBUG.
  if (fields[1] === "2") {
    throw new Error("SABnzbd DEBUG logging must be disabled before credential setup");
  }
  if (fields[2] !== "0" || !/^(?:1|true)$/i.test(fields[3])) {
    throw new Error("SABnzbd requires its private HTML-login defaults for this first-run route");
  }
}
