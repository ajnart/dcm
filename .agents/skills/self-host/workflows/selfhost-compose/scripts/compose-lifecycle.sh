#!/usr/bin/env bash

set -euo pipefail

# Ambient profiles must never turn reviewed preparation into manual-job execution.
export COMPOSE_PROFILES=''

usage() {
  printf '%s\n' 'Usage: compose-lifecycle.sh <preflight|apply|stop|selected-start|selected-stop|selected-add|selected-recreate|selected-probe|selected-remove> --manifest FILE --context NAME --project ID --file FILE [--services IDS] [--approval TOKEN] [--require-existing-volumes true]'
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
  preflight|apply|stop|selected-start|selected-stop|selected-add|selected-recreate|selected-probe|selected-remove) ;;
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
selected_services=''
require_existing_volumes=false
seen_manifest=false
seen_context=false
seen_project=false
seen_file=false
seen_approval=false
seen_services=false
seen_require_existing_volumes=false

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
    --services)
      if [[ "$seen_services" == true ]]; then fail 'duplicate option'; fi
      seen_services=true
      selected_services=$value
      ;;
    --require-existing-volumes)
      if [[ "$seen_require_existing_volumes" == true || "$value" != true ]]; then fail 'invalid existing-volume requirement'; fi
      seen_require_existing_volumes=true
      require_existing_volumes=true
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
if [[ "$action" == 'stop' && "$approval" != "STOP:$project" ]]; then
  fail 'stop requires the exact project approval token'
fi
if [[ "$action" == 'selected-start' || "$action" == 'selected-stop' || "$action" == 'selected-add' || "$action" == 'selected-recreate' || "$action" == 'selected-probe' || "$action" == 'selected-remove' ]]; then
  if [[ -z "$selected_services" || -z "$approval" ]]; then fail 'selected lifecycle requires services and exact approval'; fi
elif [[ -n "$selected_services" ]]; then
  fail 'services are valid only for selected lifecycle'
fi
if [[ "$require_existing_volumes" == true && "$action" != 'preflight' && "$action" != 'apply' ]]; then
  fail 'existing-volume requirement applies only to preflight or apply'
fi

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
validator="$script_directory/compose-project.ts"
if [[ "$action" == 'apply' ]]; then
  required_approval=$(bun "$validator" apply-approval --input "$manifest")
  if [[ "$approval" != "$required_approval" ]]; then fail 'apply requires the exact reviewed project and runtime resource approval token'; fi
fi

if [[ "$action" == 'selected-start' || "$action" == 'selected-stop' || "$action" == 'selected-add' || "$action" == 'selected-recreate' || "$action" == 'selected-probe' || "$action" == 'selected-remove' ]]; then
  selected_operation=${action#selected-}
  bun "$validator" selected-check --input "$manifest" --context "$docker_context" --project "$project" --file "$compose_file" \
    --services "$selected_services" --operation "$selected_operation" --approval "$approval" >/dev/null
else
  bun "$validator" lifecycle-check --input "$manifest" --context "$docker_context" --project "$project" --file "$compose_file" >/dev/null
fi

if [[ "$action" == 'preflight' || "$action" == 'apply' || "$action" == 'selected-start' || "$action" == 'selected-add' || "$action" == 'selected-recreate' || "$action" == 'selected-probe' ]]; then
  bun "$validator" runtime-preflight --input "$manifest" --context "$docker_context" --project "$project" --file "$compose_file" >/dev/null
fi

if [[ "$docker_context" == 'rootless' ]]; then
  if ! security_options=$(docker --context "$docker_context" info --format '{{json .SecurityOptions}}' 2>/dev/null); then
    fail "cannot reach Docker context $docker_context; restore daemon access before retrying. No containers were changed"
  fi
  case "$security_options" in
    *rootless*) ;;
    *) fail 'the rootless Docker context does not report rootless security mode. No containers were changed' ;;
  esac
else
  if ! docker --context "$docker_context" info --format '{{.ServerVersion}}' >/dev/null 2>&1; then
    fail "cannot reach Docker context $docker_context; restore daemon access before retrying. No containers were changed"
  fi
fi

volume_preflight=(bun "$validator" volume-preflight --input "$manifest" --context "$docker_context" --project "$project" --file "$compose_file")
if [[ "$action" == 'selected-add' ]]; then
  volume_preflight+=(--allow-new-volumes true)
elif [[ "$require_existing_volumes" == true || "$action" == 'selected-start' || "$action" == 'selected-recreate' ]]; then
  volume_preflight+=(--require-existing-volumes true)
fi
"${volume_preflight[@]}" >/dev/null

check_app_prestart() {
  local operation=$1 ids=${2:-}
  local checker="$script_directory/pre-start-check.ts"
  if [[ -f "$script_directory/pre-start-check.js" ]]; then checker="$script_directory/pre-start-check.js"; fi
  if [[ ! -f "$checker" || -L "$checker" ]]; then fail 'canonical app pre-start checker is missing or unsafe'; fi
  if [[ -n "$ids" ]]; then
    bun "$checker" --manifest "$manifest" --operation "$operation" --services "$ids"
  else
    bun "$checker" --manifest "$manifest" --operation "$operation"
  fi
}

docker --context "$docker_context" compose --project-name "$project" --file "$compose_file" config --quiet

if [[ "$action" == 'selected-probe' ]]; then
  check_app_prestart probe "$selected_services"
  bun "$validator" probe-run --input "$manifest" --context "$docker_context" --project "$project" --file "$compose_file" \
    --services "$selected_services" --operation probe --approval "$approval"
  exit 0
fi

if [[ "$action" == 'preflight' ]]; then
  printf '%s\n' "Compose preflight passed for project $project. No containers were changed."
  exit 0
fi

if [[ "$action" == 'selected-remove' ]]; then
  IFS=',' read -r -a service_ids <<< "$selected_services"
  check_selected_containers() {
    local service_id container_ids container_id labels
    for service_id in "${service_ids[@]}"; do
      if ! container_ids=$(docker --context "$docker_context" ps --all --no-trunc --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service_id" --format '{{.ID}}'); then
        fail 'cannot inspect selected removal containers; inspect the removal checkpoint'
      fi
      while IFS= read -r container_id; do
        if [[ -z "$container_id" ]]; then continue; fi
        if [[ ! "$container_id" =~ ^[0-9a-f]{64}$ ]]; then fail 'selected removal container identity is invalid'; fi
        if ! labels=$(docker --context "$docker_context" container inspect --format '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.oneoff"}}' "$container_id"); then
          fail 'cannot inspect exact removal container labels'
        fi
        if [[ "$labels" != "$project|$service_id|$compose_file|$(dirname -- "$compose_file")|False" ]]; then
          fail 'selected removal container differs from the exact original Compose owner'
        fi
      done <<< "$container_ids"
    done
  }
  check_selected_containers
  docker --context "$docker_context" compose --project-name "$project" --file "$compose_file" stop "${service_ids[@]}"
  check_selected_containers
  docker --context "$docker_context" compose --project-name "$project" --file "$compose_file" rm --force "${service_ids[@]}"
  for service_id in "${service_ids[@]}"; do
    if ! remaining_ids=$(docker --context "$docker_context" ps --all --no-trunc --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service_id" --format '{{.ID}}'); then
      fail 'cannot verify selected removal outcome; inspect the removal checkpoint'
    fi
    if [[ -n "$remaining_ids" ]]; then fail 'selected removal containers remain; inspect the removal checkpoint'; fi
  done
  printf '%s\n' 'Selected containers removed. Bind data, named volumes, networks and private credentials retained; application acceptance unverified.'
  exit 0
fi

if [[ "$action" == 'apply' ]]; then
  automatic_output=$(bun "$validator" automatic-services --input "$manifest")
  automatic_ids=()
  while IFS= read -r service_id; do
    if [[ -n "$service_id" ]]; then automatic_ids+=("$service_id"); fi
  done <<< "$automatic_output"
  if [[ ${#automatic_ids[@]} -eq 0 ]]; then
    printf '%s\n' "Manual-job project $project was prepared. No job was executed."
    exit 0
  fi
  check_app_prestart apply
  docker --context "$docker_context" compose --project-name "$project" --file "$compose_file" up --detach "${automatic_ids[@]}"
  printf '%s\n' "Scoped Compose up completed for project $project. Application acceptance remains unverified."
  exit 0
fi

if [[ "$action" == 'selected-start' || "$action" == 'selected-stop' || "$action" == 'selected-add' || "$action" == 'selected-recreate' ]]; then
  IFS=',' read -r -a service_ids <<< "$selected_services"
  if [[ "$action" == 'selected-add' ]]; then
    automatic_output=$(bun "$validator" automatic-services --input "$manifest")
    automatic_ids=()
    for service_id in "${service_ids[@]}"; do
      if ! existing_container=$(docker --context "$docker_context" ps --all --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service_id" --format '{{.ID}}'); then
        fail 'cannot inspect selected new services; no Compose mutation was attempted'
      fi
      if [[ -n "$existing_container" ]]; then
        fail 'a selected new service already has a container; inspect and resume before adding'
      fi
      while IFS= read -r automatic_id; do
        if [[ "$service_id" == "$automatic_id" ]]; then automatic_ids+=("$service_id"); fi
      done <<< "$automatic_output"
    done
    if [[ ${#automatic_ids[@]} -eq 0 ]]; then
      printf '%s\n' 'Selected manual jobs were prepared. No job was executed.'
      exit 0
    fi
    check_app_prestart add "$selected_services"
    docker --context "$docker_context" compose --project-name "$project" --file "$compose_file" up --detach --no-deps "${automatic_ids[@]}"
  elif [[ "$action" == 'selected-recreate' ]]; then
    check_app_prestart recreate "$selected_services"
    docker --context "$docker_context" compose --project-name "$project" --file "$compose_file" up --detach --no-deps --force-recreate "${service_ids[@]}"
  elif [[ "$action" == 'selected-start' ]]; then
    check_app_prestart start "$selected_services"
    docker --context "$docker_context" compose --project-name "$project" --file "$compose_file" up --detach --no-deps "${service_ids[@]}"
  else
    docker --context "$docker_context" compose --project-name "$project" --file "$compose_file" stop "${service_ids[@]}"
  fi
  printf '%s\n' 'Selected Compose lifecycle completed. Application acceptance remains unverified.'
  exit 0
fi

docker --context "$docker_context" compose --project-name "$project" --file "$compose_file" stop
printf '%s\n' "Scoped Compose stop completed for project $project. Volumes and project resources were retained."
