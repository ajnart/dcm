/** Pinned Warrior config/idle checks. Selection is not permission to contact HQ. */
export type WarriorIdleChoices = {
  downloader: string;
  username: string;
  password: string;
};

function choices(value: WarriorIdleChoices): void {
  if (typeof value.downloader !== "string" || !/^[-_a-zA-Z0-9]{3,30}$/.test(value.downloader)) {
    throw new Error("Warrior requires an explicitly chosen valid downloader nickname");
  }
  if (typeof value.username !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value.username)) {
    throw new Error("Warrior requires a valid chosen HTTP username");
  }
  if (typeof value.password !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(value.password)) {
    throw new Error("Warrior requires a generated private HTTP password");
  }
}

/** Secret-bearing bytes: consume only at a reviewed owner-private apply boundary.
 * Persist writable config.json for UID 1000; do not overwrite it on resume.
 * No warrior_id is fabricated, and no project (including auto) is selected.
 */
export function warriorIdleConfig(value: WarriorIdleChoices): string {
  choices(value);
  return `${JSON.stringify({
    downloader: value.downloader,
    http_username: value.username,
    http_password: value.password,
    selected_project: "none",
    concurrent_items: "1",
  })}\n`;
}

/** Inspect private persisted bytes; never echo the config or a mismatched field. */
export function verifyWarriorIdleConfig(raw: string, expected: WarriorIdleChoices): void {
  choices(expected);
  if (raw.length > 65_536) throw new Error("Warrior private config exceeds the bound");
  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error("Warrior private config is invalid JSON");
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Warrior private config is invalid");
  }
  const saved = config as Record<string, unknown>;
  if (saved.downloader !== expected.downloader || saved.http_username !== expected.username
    || saved.http_password !== expected.password || saved.selected_project !== "none"
    || (saved.concurrent_items !== "1" && saved.concurrent_items !== 1)) {
    throw new Error("Warrior private config differs from the reviewed idle identity");
  }
}

/** Input must be one bounded SockJS opening snapshot from the exact saved private
 * origin, not events accumulated across reconnects. Login proof is separate.
 * NO_PROJECT is source-defined; HTTP 200 alone is deliberately not accepted.
 */
export function verifyWarriorIdleSnapshot(events: readonly unknown[]): void {
  if (events.length < 2 || events.length > 16) {
    throw new Error("Warrior idle snapshot exceeds the bound or is incomplete");
  }
  let statusSeen = false;
  let projectSeen = false;
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error("Warrior idle snapshot event is invalid");
    }
    const data = event as Record<string, unknown>;
    if (typeof data.event_name !== "string" || !Object.hasOwn(data, "message")) {
      throw new Error("Warrior idle snapshot event is invalid");
    }
    if (data.event_name === "project.refresh") {
      if (projectSeen || data.message !== null) {
        throw new Error("Warrior has an active or ambiguous project snapshot");
      }
      projectSeen = true;
    }
    if (data.event_name === "warrior.status") {
      const message = data.message;
      if (statusSeen || !message || typeof message !== "object" || Array.isArray(message)
        || (message as Record<string, unknown>).status !== "NO_PROJECT") {
        throw new Error("Warrior is not in the verified NO_PROJECT state");
      }
      statusSeen = true;
    }
    if (data.event_name === "warrior.project_selected"
      || data.event_name === "warrior.project_installing"
      || data.event_name === "warrior.project_installed"
      || data.event_name === "warrior.project_installation_failed"
      || data.event_name === "runner.status"
      || data.event_name.startsWith("pipeline.")
      || data.event_name.startsWith("item.")) {
      throw new Error("Warrior snapshot contains archival work or a project transition");
    }
  }
  if (!statusSeen || !projectSeen) {
    throw new Error("Warrior idle snapshot lacks effective status or project readback");
  }
}
