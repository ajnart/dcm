#!/usr/bin/env bash

agent_validate() {
  local name="$1" file="$2" head="$3" release_version="$4" filter
  jq -e --arg name "$name" --arg head "$head" --arg version "$release_version" \
    '.checkpoint == $name and .head == $head and .version == $version and .verified == true and
     (.checkedAt | type == "string" and length > 0) and (.evidence | type == "object")' \
    "$file" >/dev/null || die "agent evidence does not match this checkpoint, commit and version"
  case "$name" in
    cloudflare-ready)
      filter='.evidence | (.pagesProjectId | type == "string" and length > 0) and (.rollbackSnapshot | type == "string" and length > 0) and .staleGitDeploymentsPrevented == true'
      ;;
    cloudflare-deployed)
      filter='.evidence | (.pagesProjectId | type == "string" and length > 0) and (.deploymentId | type == "string" and length > 0) and .url == "https://self-host.fyi" and .composeVerified == true and .publicInstallerVerified == true'
      ;;
    legacy-redirects)
      filter='.evidence | (.hosts | sort) == ["compose.ajnart.dev","compose.homarr.dev"] and (.zoneIds | length == 2) and (.rollbackSnapshot | type == "string" and length > 0) and .unrelatedRulesPreserved == true'
      ;;
    telemetry-reviewed)
      filter='.evidence | (.reason | type == "string" and length > 0) and (.action == "unchanged" or .action == "configured" or .action == "not-needed") and (if .action == "configured" then .projectId != null and (.projectId | tostring | length > 0) else true end)'
      ;;
    *) die "unknown agent checkpoint: $name" ;;
  esac
  jq -e "$filter" "$file" >/dev/null || die "agent evidence lacks required verification details for $name"
}

agent_record() {
  local name="$1" file="$2" directory="$3" state_head state_version destination
  [[ -n "$directory" && -s "$directory/state.json" ]] || die "recording evidence requires the existing run's --log-dir"
  [[ -n "$file" && -s "$file" ]] || die "--evidence must name an actual completed MCP verification record, not a placeholder"
  [[ ! -d "$root/.scratch/migration/run.lock" ]] || die "wait until the migration is paused before recording agent evidence"
  directory="$(cd "$directory" && pwd)"
  state_head="$(jq -er .settings.head "$directory/state.json")"
  state_version="$(jq -er .settings.version "$directory/state.json")"
  [[ "$(git rev-parse HEAD)" == "$state_head" ]] || die "HEAD differs from the migration commit"
  agent_validate "$name" "$file" "$state_head" "$state_version"
  destination="$directory/agent-$name.json"
  if [[ -e "$destination" ]]; then
    cmp -s "$file" "$destination" || die "different evidence already exists; inspect it instead of overwriting the audit record"
    say "agent evidence already recorded: $destination"
    return 0
  fi
  cp "$file" "$destination.partial"
  mv "$destination.partial" "$destination"
  jq -cn --arg time "$(date -u +%FT%TZ)" --arg checkpoint "$name" --arg evidence "$destination" \
    '{time:$time,event:"agent-verified",checkpoint:$checkpoint,evidence:$evidence}' >> "$directory/events.jsonl"
  say "recorded verified agent checkpoint: $destination"
}

agent_checkpoint() {
  local name="$1" file="$log_dir/agent-$1.json" task
  if [[ -s "$file" ]]; then agent_validate "$name" "$file" "$head_sha" "$version"; say "agent evidence verified: $file"; return 0; fi
  case "$name" in
    cloudflare-ready) task="Use Cloudflare MCP to inspect/snapshot the current Pages project, domains, DNS and redirect rules; prevent the old repository's Git integration from deploying a stale site during the swap. Preserve rollback data. Do not enable legacy redirects yet." ;;
    cloudflare-deployed) task="Use Cloudflare MCP to configure the chosen Pages/Git integration and deploy the exact site bundle. If asset upload needs Wrangler, use its managed login without extracting tokens. Verify self-host.fyi/compose and its public installer before recording evidence." ;;
    legacy-redirects) task="Use Cloudflare MCP to set root/path redirects on compose.ajnart.dev and compose.homarr.dev only after the destination passed script verification. Preserve queries, proxied DNS and unrelated rules; retain the old project for rollback." ;;
    telemetry-reviewed) task="Determine whether the migration needs a PostHog configuration change. Use PostHog MCP if necessary; record verified existing settings or the narrowly required change. No unrelated analytics queries or blanket settings changes." ;;
    *) die "unknown agent checkpoint: $name" ;;
  esac
  jq -n --arg checkpoint "$name" --arg head "$head_sha" --arg version "$version" --arg task "$task" \
    '{checkpoint:$checkpoint,head:$head,version:$version,status:"pending",task:$task}' > "$log_dir/agent-request-$name.json"
  say "AGENT HANDOFF: $name"
  say "$task"
  say "Commit: $head_sha; release: $version; logs/artifacts: $log_dir"
  say "After performing and verifying the actual work, save its redacted evidence JSON and record it with:"
  printf 'scripts/migrate/run-all.sh --record-agent-step %q --evidence /absolute/path/to/verified-evidence.json --log-dir %q\n' "$name" "$log_dir"
  exit 75
}

agent_prepare_site() {
  local marker="$log_dir/site-build.json"
  if [[ -s "$marker" ]]; then
    jq -e --arg head "$head_sha" --arg version "$version" '.head == $head and .version == $version' "$marker" >/dev/null || die "site artifact marker belongs to another commit/version"
    [[ -f "$log_dir/site-dist/compose.html" && -f "$log_dir/site-dist/install.sh.sha256" ]] || die "recorded site bundle is missing; inspect before rebuilding"
    return 0
  fi
  SELF_HOST_SITE_VERSION="$version" SITE_RELEASE_REPO=ajnart/self-host "$root/scripts/build-site-pages.sh"
  [[ ! -e "$log_dir/site-dist" ]] || die "unrecorded site-dist exists; inspect before replacing it"
  cp -R "$root/site/dist-pages" "$log_dir/site-dist"
  jq -n --arg head "$head_sha" --arg version "$version" '{head:$head,version:$version}' > "$marker.partial"
  mv "$marker.partial" "$marker"
  say "Deploy this exact prepared bundle: $log_dir/site-dist"
}

verify_public_site() {
  local route file
  mkdir -p "$log_dir/public-site"
  for route in / /compose /compose/templates /compose/template/recipe-full; do
    file="${route//\//_}"
    curl -fsSL --connect-timeout 15 --max-time 90 --retry 3 "https://self-host.fyi$route?migration=$head_sha" -o "$log_dir/public-site/$file.html"
    grep -qF "data-version=\"$version\"" "$log_dir/public-site/$file.html" || die "public $route does not show the new version"
  done
  grep -qF 'https://self-host.fyi/og/compose.png' "$log_dir/public-site/_compose.html" || die "public /compose is not the merged DCM page"
  curl -fsSL --connect-timeout 15 --max-time 90 https://self-host.fyi/install.sh -o "$log_dir/public-site/install.sh"
  curl -fsSL --connect-timeout 15 --max-time 90 https://self-host.fyi/install.sh.sha256 -o "$log_dir/public-site/install.sh.sha256"
  (cd "$log_dir/public-site" && shasum -a 256 -c install.sh.sha256)
  cmp "$root/install.sh" "$log_dir/public-site/install.sh" || die "site serves an unexpected installer"
  env -u SELF_HOST_GITHUB_TOKEN VERIFY_INSTALL_URL=https://self-host.fyi/install \
    VERIFY_EXPECTED_VERSION="$version" VERIFY_PINNED_VERSION="$previous_version" "$root/scripts/verify-install.sh"
  if [[ "$previous_version" != 0.3.0 ]]; then
    env -u SELF_HOST_GITHUB_TOKEN VERIFY_INSTALL_URL=https://self-host.fyi/install \
      VERIFY_EXPECTED_VERSION="$version" VERIFY_PINNED_VERSION=0.3.0 "$root/scripts/verify-install.sh"
  fi
}

verify_legacy_redirects() {
  local host path expected result status location
  for host in compose.ajnart.dev compose.homarr.dev; do
    for path in '/?share=check&apps=homarr%2Cjellyfin' '/templates?migration_check=1' '/template/recipe-full?migration_check=1'; do
      expected="https://self-host.fyi/compose$path"
      if [[ "$path" == /\?* ]]; then expected="https://self-host.fyi/compose${path#/}"; fi
      result="$(curl -sS --connect-timeout 15 --max-time 60 --output /dev/null --write-out $'%{http_code}\n%{redirect_url}' "https://$host$path")"
      status="${result%%$'\n'*}"
      location="${result#*$'\n'}"
      [[ "$status" == 301 && "$location" == "$expected" ]] || die "$host$path returned $status -> $location; expected 301 -> $expected"
      say "verified $host$path -> $location"
    done
  done
}
