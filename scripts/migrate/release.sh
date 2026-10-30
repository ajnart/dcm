#!/usr/bin/env bash

release_preflight() {
  local releases latest repo
  releases="$(gh release list --repo "$old" --limit 1000 --json tagName,isDraft,isPrerelease)"
  latest="$(printf '%s' "$releases" | python3 -c '
import json,re,sys
requested=tuple(map(int,sys.argv[1].split(".")))
versions=[]
for release in json.load(sys.stdin):
    match=re.fullmatch(r"(?:new-cli-)?v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)",release["tagName"])
    if match and not release["isDraft"] and not release["isPrerelease"]:
        versions.append((tuple(map(int,match.groups())),release["tagName"]))
if not versions: sys.exit("no stable CLI release found")
number,tag=max(versions)
if requested<=number: sys.exit("requested version must be newer than every existing stable CLI release")
print(".".join(map(str,number)),tag)
' "$version")"
  read -r previous_version previous_tag <<<"$latest"
  if git show-ref --verify --quiet "refs/tags/v$version"; then die "the requested version tag already exists locally"; fi
  for repo in "$old" "$new"; do
    [[ "$(gh api "repos/$repo/git/matching-refs/tags/v$version" --jq length)" -eq 0 ]] || die "the requested version tag already exists on $repo; never retag a release"
    [[ "$(gh release list --repo "$repo" --limit 1000 --json tagName --jq "[.[] | select(.tagName == \"v$version\")] | length")" -eq 0 ]] || die "the requested release already exists on $repo"
  done
}

release_assets() {
  local os arch extension
  for os in linux darwin; do
    for arch in amd64 arm64; do printf 'self-host_%s_%s_%s.tar.gz\n' "$version" "$os" "$arch"; done
  done
  for arch in amd64 arm64; do
    for extension in deb rpm apk pkg.tar.zst; do printf 'self-host_%s_linux_%s.%s\n' "$version" "$arch" "$extension"; done
  done
  printf '%s\n' PKGBUILD checksums.txt
}

release_check_dist() {
  local asset
  while IFS= read -r asset; do [[ -f "$root/dist/$asset" ]] || die "missing release asset: $asset"; done < <(release_assets)
  (cd "$root/dist" && shasum -a 256 -c checksums.txt)
}

release_build() {
  local binary native_os native_arch
  if [[ -s "$log_dir/release-build.json" ]]; then
    jq -e --arg head "$head_sha" --arg version "$version" '.head == $head and .version == $version' "$log_dir/release-build.json" >/dev/null || die "release build does not match this commit/version"
    if [[ ! -e "$root/dist" ]]; then cp -R "$log_dir/release-dist" "$root/dist"; fi
    cmp "$root/dist/checksums.txt" "$log_dir/release-dist/checksums.txt" || die "dist differs from the original release build; do not rebuild a published version"
    cmp "$root/dist/PKGBUILD" "$log_dir/release-dist/PKGBUILD" || die "PKGBUILD differs from the original release build"
    cmp "$root/dist/homebrew/Casks/self-host.rb" "$log_dir/release-dist/homebrew/Casks/self-host.rb" || die "Homebrew cask differs from the original release build"
    release_check_dist
    return 0
  fi
  if gh release view "v$version" --repo ajnart/self-host >/dev/null 2>&1; then die "release exists without a recorded local build; refusing to rebuild it"; fi
  if [[ ! -f "$log_dir/dist-prepared" ]]; then
    if [[ -e "$root/dist" ]]; then
      [[ -d "$root/dist" && ! -L "$root/dist" && ! -e "$log_dir/dist-before" ]] || die "cannot safely preserve existing dist"
      mv "$root/dist" "$log_dir/dist-before"
    fi
    date -u +%FT%TZ > "$log_dir/dist-prepared"
  fi
  SELF_HOST_RELEASE_VERSION="$version" GOFLAGS=-buildvcs=false \
    go run github.com/goreleaser/goreleaser/v2@v2.18.3 release --snapshot --clean
  cp "$root/dist/aur/self-host-bin.pkgbuild" "$root/dist/PKGBUILD"
  release_check_dist
  for binary in "$root"/dist/self-host_*/self-host; do
    [[ -f "$binary" ]] || die "GoReleaser produced no binaries"
    grep -aq phc_ "$binary" || die "release binary lacks the required telemetry project key"
  done
  native_os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$(uname -m)" in arm64|aarch64) native_arch=arm64 ;; x86_64|amd64) native_arch=amd64 ;; *) die "unsupported native release verification architecture" ;; esac
  mkdir -p "$log_dir/native-release"
  tar -xzf "$root/dist/self-host_${version}_${native_os}_${native_arch}.tar.gz" -C "$log_dir/native-release" self-host
  [[ "$(SELF_HOST_NO_TELEMETRY=1 "$log_dir/native-release/self-host" --version)" == "$version" ]] || die "native binary reports the wrong version"
  SELF_HOST_NO_TELEMETRY=1 "$log_dir/native-release/self-host" apps list --json >/dev/null
  SELF_HOST_NO_TELEMETRY=1 "$log_dir/native-release/self-host" skill >/dev/null
  [[ ! -e "$log_dir/release-dist" ]] || die "unrecorded release-dist exists; inspect it before retrying packaging"
  cp -R "$root/dist" "$log_dir/release-dist"
  jq -n --arg head "$head_sha" --arg version "$version" '{head:$head,version:$version}' > "$log_dir/release-build.json.partial"
  mv "$log_dir/release-build.json.partial" "$log_dir/release-build.json"
}

release_publish() {
  local info asset remote_names dir
  local -a assets missing note_flags
  release_build
  assets=()
  while IFS= read -r asset; do assets+=("$root/dist/$asset"); done < <(release_assets)
  if ! gh release view "v$version" --repo ajnart/self-host >/dev/null 2>&1; then
    note_flags=(--generate-notes --notes-start-tag "$previous_tag")
    if [[ -n "$notes" ]]; then note_flags=(--notes-file "$notes"); fi
    gh release create "v$version" "${assets[@]}" --repo ajnart/self-host --target "$head_sha" --draft --title "self-host $version" "${note_flags[@]}"
  fi
  info="$(gh release view "v$version" --repo ajnart/self-host --json targetCommitish,isDraft,assets)"
  [[ "$(jq -r .targetCommitish <<<"$info")" == "$head_sha" ]] || die "release targets a different commit"
  remote_names="$(jq -r '.assets[].name' <<<"$info")"
  missing=()
  while IFS= read -r asset; do
    if ! grep -qxF -- "$asset" <<<"$remote_names"; then missing+=("$root/dist/$asset"); fi
  done < <(release_assets)
  if [[ "${#missing[@]}" -gt 0 ]]; then
    [[ "$(jq -r .isDraft <<<"$info")" == true ]] || die "published release is incomplete; do not replace immutable published assets"
    gh release upload "v$version" --repo ajnart/self-host "${missing[@]}"
  fi
  dir="$(mktemp -d "$log_dir/release-download.XXXXXX")"
  gh release download "v$version" --repo ajnart/self-host --dir "$dir"
  while IFS= read -r asset; do cmp "$root/dist/$asset" "$dir/$asset" || die "uploaded release bytes differ: $asset"; done < <(release_assets)
  (cd "$dir" && shasum -a 256 -c checksums.txt)
  if [[ "$(jq -r .isDraft <<<"$info")" == true ]]; then gh release edit "v$version" --repo ajnart/self-host --draft=false --latest; fi
  [[ "$(gh api "repos/ajnart/self-host/commits/v$version" --jq .sha)" == "$head_sha" ]] || die "published release tag points elsewhere"
}

release_dispatch_watch() {
  local workflow="$1" ref="$2" inputs="${3:-}" file response id
  [[ -n "$inputs" ]] || inputs='{}'
  file="$log_dir/workflow-$workflow.json"
  if [[ ! -s "$file" ]]; then
    response="$(jq -cn --arg ref "$ref" --argjson inputs "$inputs" '{ref:$ref,inputs:$inputs}' \
      | gh api -X POST -H 'X-GitHub-Api-Version: 2026-03-10' "repos/ajnart/self-host/actions/workflows/$workflow/dispatches" --input -)"
    jq -e '.workflow_run_id | numbers' <<<"$response" >/dev/null || die "workflow dispatch returned no run ID; inspect Actions before retrying"
    printf '%s\n' "$response" > "$file.partial"
    mv "$file.partial" "$file"
  fi
  id="$(jq -er .workflow_run_id "$file")"
  [[ "$(gh api "repos/ajnart/self-host/actions/runs/$id" --jq .head_sha)" == "$head_sha" ]] || die "workflow run targets a different commit"
  say "Watching $workflow: https://github.com/ajnart/self-host/actions/runs/$id"
  gh run watch "$id" --repo ajnart/self-host --compact --exit-status
}

release_refresh_dcm() { release_dispatch_watch dcm-image.yml main; }

release_docker() {
  release_build
  "$root/scripts/publish-docker.sh" "$version"
}

release_homebrew() {
  release_build
  "$root/scripts/publish-homebrew.sh" "$version"
}

release_watch_ci() {
  local id
  id="$(gh run list --repo ajnart/self-host --workflow ci.yml --commit "$head_sha" --event push --limit 30 --json databaseId --jq '.[0].databaseId // empty')"
  [[ -n "$id" ]] || die "main-push CI run not found; inspect Actions before archiving the old repository"
  gh run watch "$id" --repo ajnart/self-host --compact --exit-status
  release_dispatch_watch release.yml "v$version" "$(jq -cn --arg tag "v$version" '{tag:$tag}')"
}
