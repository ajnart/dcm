#!/usr/bin/env bash
# Step 2 (before the rename) and step 6 (verification after it) of docs/migration/dcm-takeover.md.
# Recreates every GitHub Release of the old repo on the new one: same tag, title, notes, flags, assets.
# Dry run unless --yes. Idempotent: a release that exists on the new repo has its asset names and sizes
# compared with the old one, and missing or different assets are uploaded with --clobber.
# Notes, title and flags of an existing release are not touched.
#
# Before the rename:  --old ajnart/self-host      --new ajnart/dcm
# After the rename:   --old ajnart/self-host-old  --new ajnart/self-host   (the defaults)
#
# The tags must already be on the new repo (push-merged-history.sh); --verify-tag refuses to invent one.
# Release dates are the dates of this run, oldest release first so the list keeps its order.
set -euo pipefail

usage="usage: scripts/migrate/backport-releases.sh [--yes] [--old OWNER/REPO] [--new OWNER/REPO] [--only TAG] [--rename-dcm-v1]"
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$here/lib.sh"

old_repo="$OWNER/self-host-old"
new_repo="$OWNER/self-host"
only=""
rename_v1=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) YES=true ;;
    --old) old_repo="${2:?$usage}"; shift ;;
    --new) new_repo="${2:?$usage}"; shift ;;
    --only) only="${2:?$usage}"; shift ;;
    --rename-dcm-v1) rename_v1=true ;;
    -h|--help) say "$usage"; exit 0 ;;
    *) die "$usage" ;;
  esac
  shift
done

need gh
need jq
gh auth status >/dev/null 2>&1 || die "gh is not authenticated"
[[ "$old_repo" != "$new_repo" ]] || die "--old and --new are the same"
repo_exists "$old_repo" || die "$old_repo not found"
repo_exists "$new_repo" || die "$new_repo not found"
[[ "$(gh api "repos/$old_repo" --jq .id)" != "$(gh api "repos/$new_repo" --jq .id)" ]] \
  || die "$old_repo and $new_repo are the same repository (already renamed?); pass the real old and new names"
mode_banner
say "$old_repo -> $new_repo"

work="$(mktemp -d "${TMPDIR:-/tmp}/backport-releases.XXXXXX")"
trap 'rm -rf "$work"' EXIT

releases="$(gh release list --repo "$old_repo" --limit 1000 --json tagName,isDraft,isLatest,publishedAt,createdAt \
  --jq 'sort_by(.publishedAt // .createdAt) | .[] | [.tagName, .isDraft, .isLatest] | @tsv')"
[[ -n "$releases" ]] || die "no releases on $old_repo"

latest_tag=""
created=0 skipped=0 synced=0 failed=0
while IFS=$'\t' read -r tag is_draft is_latest; do
  [[ -z "$only" || "$only" == "$tag" ]] || continue
  [[ "$is_latest" == true ]] && latest_tag="$tag"

  if have="$(gh release view "$tag" --repo "$new_repo" --json assets 2>/dev/null)"; then
    want="$(gh release view "$tag" --repo "$old_repo" --json assets)"
    fix="$(jq -r --argjson have "$have" \
      '.assets[] | select(.name as $n | .size as $s | ($have.assets | map(select(.name == $n and .size == $s)) | length) == 0) | .name' <<<"$want")"
    extra="$(jq -r --argjson want "$want" \
      '.assets[] | select(.name as $n | ($want.assets | map(select(.name == $n)) | length) == 0) | .name' <<<"$have")"
    [[ -z "$extra" ]] || say "note   $tag: assets only on $new_repo (left alone): $(tr '\n' ' ' <<<"$extra")"
    if [[ -z "$fix" ]]; then
      say "skip   $tag (exists on $new_repo, assets match)"; skipped=$((skipped + 1)); continue
    fi
    say "sync   $tag: missing or different on $new_repo: $(tr '\n' ' ' <<<"$fix")"
    if ! $YES; then
      printf '+ gh release download %q --repo %q --pattern <asset> --dir <tmp>/%q\n' "$tag" "$old_repo" "$tag"
      printf '+ gh release upload %q --repo %q --clobber <assets>\n' "$tag" "$new_repo"
      synced=$((synced + 1)); continue
    fi
    dir="$work/$tag"
    mkdir -p "$dir/assets"
    files=()
    ok=true
    while IFS= read -r name; do
      [[ -n "$name" ]] || continue
      gh release download "$tag" --repo "$old_repo" --pattern "$name" --dir "$dir/assets" --clobber || ok=false
      files+=("$dir/assets/$name")
    done <<<"$fix"
    if $ok && gh release upload "$tag" "${files[@]}" --repo "$new_repo" --clobber; then
      got="$(gh release view "$tag" --repo "$new_repo" --json assets --jq '.assets[] | "\(.name) \(.size)"' | sort)"
      exp="$(jq -r '.assets[] | "\(.name) \(.size)"' <<<"$want" | sort)"
      if [[ -z "$(comm -23 <(printf '%s\n' "$exp") <(printf '%s\n' "$got"))" ]]; then
        synced=$((synced + 1))
      else
        say "FAIL   $tag: assets still differ after sync"; failed=$((failed + 1))
      fi
    else
      say "FAIL   $tag: asset sync failed; rerun to retry"; failed=$((failed + 1))
    fi
    rm -rf "$dir"
    continue
  fi
  if ! gh api "repos/$new_repo/git/ref/tags/$tag" --jq .object.sha >/dev/null 2>&1; then
    say "FAIL   $tag: tag is not on $new_repo; run push-merged-history.sh"; failed=$((failed + 1)); continue
  fi

  info="$(gh release view "$tag" --repo "$old_repo" --json name,body,isPrerelease,isDraft,assets)"
  title="$(jq -r '.name // ""' <<<"$info")"
  [[ -n "$title" ]] || title="$tag"
  n_assets="$(jq '.assets | length' <<<"$info")"
  bytes="$(jq '[.assets[].size] | add // 0' <<<"$info")"
  say "create $tag \"$title\" ($n_assets assets, $((bytes / 1000000)) MB, prerelease=$(jq -r .isPrerelease <<<"$info"), draft=$is_draft)"

  dir="$work/$tag"
  mkdir -p "$dir/assets"
  jq -r '.body // ""' <<<"$info" >"$dir/notes.md"
  flags=(--repo "$new_repo" --verify-tag --title "$title" --notes-file "$dir/notes.md" --latest=false)
  [[ "$(jq -r .isPrerelease <<<"$info")" == true ]] && flags+=(--prerelease)
  [[ "$is_draft" == true ]] && flags+=(--draft)

  if ! $YES; then
    printf '+ gh release download %q --repo %q --dir <tmp>/%q/assets\n' "$tag" "$old_repo" "$tag"
    printf '+ gh release create %q %s<%s assets>\n' "$tag" "$(printf '%q ' "${flags[@]}")" "$n_assets"
    created=$((created + 1)); continue
  fi

  if [[ "$n_assets" -gt 0 ]]; then
    gh release download "$tag" --repo "$old_repo" --dir "$dir/assets" --clobber
  fi
  files=()
  while IFS= read -r f; do files+=("$f"); done < <(find "$dir/assets" -type f | sort)
  if gh release create "$tag" "${flags[@]}" ${files[@]+"${files[@]}"}; then
    want="$(jq -r '.assets[] | "\(.name) \(.size)"' <<<"$info" | sort)"
    got="$(gh release view "$tag" --repo "$new_repo" --json assets --jq '.assets[] | "\(.name) \(.size)"' | sort)"
    if [[ "$want" == "$got" ]]; then
      created=$((created + 1))
    else
      say "FAIL   $tag: assets differ after upload"; diff <(printf '%s\n' "$want") <(printf '%s\n' "$got") || true; failed=$((failed + 1))
    fi
  else
    say "FAIL   $tag: gh release create failed; rerun to retry (a half-created release must be deleted by hand first)"; failed=$((failed + 1))
  fi
  rm -rf "$dir"
done <<<"$releases"

say "-- Latest"
if [[ -n "$only" ]]; then
  say "skipped with --only"
elif [[ -n "$latest_tag" ]]; then
  if gh release view "$latest_tag" --repo "$new_repo" >/dev/null 2>&1 || ! $YES; then
    run gh release edit "$latest_tag" --repo "$new_repo" --latest
  fi
else
  say "WARN $old_repo has no release marked Latest"
fi

if $rename_v1; then
  say "-- DCM's own v1 release"
  if gh release view v1 --repo "$new_repo" >/dev/null 2>&1; then
    run gh release edit v1 --repo "$new_repo" --title "DCM v1"
  else
    say "no v1 release on $new_repo"
  fi
fi

say "-- summary: created $created, assets synced $synced, unchanged $skipped, failed $failed"
[[ $failed -eq 0 ]] || die "$failed release(s) failed"
