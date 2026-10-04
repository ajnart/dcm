type Handoff = Record<string, any>;

/** Presentation only. Values enter this function after the owner-only handoff checks. */
export function formatSharedHandoff(handoff: Handoff, show: boolean): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handoff.appId)
    || handoff.secretful !== show) throw new Error("Credential recap requires an exact handoff mode");
  const prefix = handoff.appId.toUpperCase().replaceAll("-", "_");
  const lines: string[] = [];
  const add = (key: string, value: unknown) => {
    if (value === null || value === undefined) return;
    if (typeof value !== "string") throw new Error("Credential recap contains an invalid value");
    lines.push(`${prefix}_${key}=${JSON.stringify(value)}`);
  };
  add("URL", handoff.url);
  if (handoff.setupUrl !== handoff.url) add("SETUP_URL", handoff.setupUrl);
  if (!handoff.url && handoff.endpoint) {
    const endpoint = handoff.endpoint;
    add("CONNECTION", `${endpoint.protocol}://${endpoint.host}:${endpoint.port}`);
  }
  add("USERNAME", handoff.username);
  add("TOKEN_FILE", handoff.tokenFile);
  add("CLIENT_KEY_CUSTODY_FILE", handoff.clientKeyCustodyFile);
  if (show) {
    lines.unshift("# Private credential recap. Do not source this output as a shell script.");
    add("PASSWORD", handoff.password);
    add("API_KEY", handoff.apiKey);
  } else {
    add("PASSWORD_FILE", handoff.passwordFile);
    add("API_KEY_FILE", handoff.apiKeyFile);
  }
  const named = show ? handoff.credentials : handoff.credentialFiles;
  for (const [fileId, value] of Object.entries(named ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fileId)) throw new Error("Credential recap contains an invalid file identity");
    let key = fileId.toUpperCase().replaceAll("-", "_");
    if (!show) key += "_FILE";
    add(`PRIVATE_${key}`, value);
  }
  if (handoff.manualJob === true) lines.push("# Prepared job; no workload has run.");
  else if (handoff.loginVia === "jellyfin") lines.push("# Log in with the saved Jellyfin administrator account.");
  else if (handoff.loginVia === "gpg-client-enrollment") lines.push("# Native OpenPGP client-key login; use the private custody bundle, not a password/API key.");
  else if (handoff.username === null && handoff.passwordFile === null && handoff.tokenFile === null) {
    lines.push("# No local username/password is configured.");
  }
  if (lines.length === 0) lines.push(`${handoff.appId}: no credentials recorded`);
  return lines.join("\n");
}
