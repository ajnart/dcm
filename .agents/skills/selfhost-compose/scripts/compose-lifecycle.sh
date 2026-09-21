#!/usr/bin/env bash

set -euo pipefail

usage() {
  printf '%s\n' 'Usage: compose-lifecycle.sh <preflight|apply|stop> --manifest FILE --context NAME --project ID --file FILE [--approval TOKEN]'
}

fail() {
  printf '%s\n' "compose-lifecycle.sh: $1" >&2
  exit 2
}

if [[ $# -eq 0 ]]; then
  usage
  exit 2
fi

action=$1
shift

case "$action" in
  preflight|apply|stop) ;;
  --help|-h)
    usage
    exit 0
    ;;
  *) fail 'unsupported action' ;;
esac

manifest=''
docker_context=''
project=''
compose_file=''
approval=''
seen_manifest=false
seen_context=false
seen_project=false
seen_file=false
seen_approval=false

while [[ $# -gt 0 ]]; do
  flag=$1
  shift
  if [[ $# -eq 0 ]]; then
    fail 'an option is missing its value'
  fi
  value=$1
  shift
  case "$flag" in
    --manifest)
      if [[ "$seen_manifest" == true ]]; then fail 'duplicate option'; fi
      seen_manifest=true
      manifest=$value
      ;;
    --project)
      if [[ "$seen_project" == true ]]; then fail 'duplicate option'; fi
      seen_project=true
      project=$value
      ;;
    --context)
      if [[ "$seen_context" == true ]]; then fail 'duplicate option'; fi
      seen_context=true
      docker_context=$value
      ;;
    --file)
      if [[ "$seen_file" == true ]]; then fail 'duplicate option'; fi
      seen_file=true
      compose_file=$value
      ;;
    --approval)
      if [[ "$seen_approval" == true ]]; then fail 'duplicate option'; fi
      seen_approval=true
      approval=$value
      ;;
    *) fail 'unsupported option' ;;
  esac
done

if [[ -z "$manifest" || -z "$docker_context" || -z "$project" || -z "$compose_file" ]]; then
  fail '--manifest, --context, --project, and --file are required'
fi

if [[ "$action" == 'preflight' && -n "$approval" ]]; then
  fail 'preflight does not accept an approval token'
fi
if [[ "$action" == 'apply' && "$approval" != "APPLY:$project" ]]; then
  fail 'apply requires the exact project approval token'
fi
if [[ "$action" == 'stop' && "$approval" != "STOP:$project" ]]; then
  fail 'stop requires the exact project approval token'
fi

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
validator="$script_directory/compose-project.ts"

bun "$validator" lifecycle-check --input "$manifest" --context "$docker_context" --project "$project" --file "$compose_file" >/dev/null

if ! docker --context "$docker_context" info --format '{{.ServerVersion}}' >/dev/null 2>&1; then
  fail "cannot reach Docker context $docker_context; restore daemon access before retrying. No containers were changed"
fi

docker --context "$docker_context" compose --project-name "$project" --file "$compose_file" config --quiet

if [[ "$action" == 'preflight' ]]; then
  printf '%s\n' "Compose preflight passed for project $project. No containers were changed."
  exit 0
fi

if [[ "$action" == 'apply' ]]; then
  docker --context "$docker_context" compose --project-name "$project" --file "$compose_file" up --detach
  printf '%s\n' "Scoped Compose up completed for project $project. Application acceptance remains unverified."
  exit 0
fi

docker --context "$docker_context" compose --project-name "$project" --file "$compose_file" stop
printf '%s\n' "Scoped Compose stop completed for project $project. Volumes and project resources were retained."
