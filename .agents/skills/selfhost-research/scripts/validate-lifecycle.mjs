#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const VALID_STATUSES = new Set(["active", "transitioning", "verify", "retired"]);
const VALID_IMAGE_SOURCES = new Set(["upstream", "vendor", "community", "unknown", "not-applicable"]);
const SECRET_QUERY = /(?:pass(?:word|phrase)?|secret|token|api[-_.]?key|access[-_.]?key|private[-_.]?key|client[-_.]?secret|credential|authorization|cookie|session)/i;

function usage() {
  return "Usage: node validate-lifecycle.mjs [--file FILE] [--max-age-days N] [--strict] [--pretty]";
}

function parseArgs(argv) {
  const options = { file: null, maxAgeDays: 180, strict: false, pretty: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--file") {
      index += 1;
      if (index >= argv.length) {
        throw new Error("missing_file_argument");
      }
      options.file = argv[index];
      continue;
    }
    if (argument === "--max-age-days") {
      index += 1;
      const value = Number(argv[index]);
      if (!Number.isInteger(value) || value < 1 || value > 3650) {
        throw new Error("invalid_max_age_days");
      }
      options.maxAgeDays = value;
      continue;
    }
    if (argument === "--strict") {
      options.strict = true;
      continue;
    }
    if (argument === "--pretty") {
      options.pretty = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    throw new Error("unknown_argument");
  }
  return options;
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_INPUT_BYTES) {
      throw new Error("input_too_large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readInput(file) {
  if (file === null) {
    return readStdin();
  }
  const buffer = await readFile(file);
  if (buffer.length > MAX_INPUT_BYTES) {
    throw new Error("input_too_large");
  }
  return buffer.toString("utf8");
}

function addCode(list, code) {
  if (!list.includes(code)) {
    list.push(code);
  }
}

function safeId(value, errors) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    addCode(errors, "missing_or_invalid_id");
    return "unknown";
  }
  return value;
}

function safePublicUrl(value, errors, code) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    addCode(errors, `invalid_${code}`);
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    addCode(errors, `invalid_${code}_scheme`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    addCode(errors, `${code}_contains_credentials`);
    parsed.username = "REDACTED";
    parsed.password = "";
  }
  for (const name of Array.from(parsed.searchParams.keys())) {
    if (!SECRET_QUERY.test(name)) {
      continue;
    }
    addCode(errors, `${code}_contains_secret_query`);
    parsed.searchParams.set(name, "REDACTED");
  }
  return parsed.toString();
}

function checkedDate(value, errors) {
  if (typeof value !== "string" || value.length === 0) {
    addCode(errors, "missing_checked_at");
    return { value: null, timestamp: null };
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
    addCode(errors, "invalid_checked_at");
    return { value: null, timestamp: null };
  }
  let parseValue = value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    parseValue += "T00:00:00Z";
  }
  const timestamp = Date.parse(parseValue);
  if (!Number.isFinite(timestamp)) {
    addCode(errors, "invalid_checked_at");
    return { value: null, timestamp: null };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const normalized = new Date(timestamp).toISOString().slice(0, 10);
    if (normalized !== value) {
      addCode(errors, "invalid_checked_at");
      return { value: null, timestamp: null };
    }
  }
  return { value, timestamp };
}

function replacementRecord(record, lifecycle, errors, warnings, status) {
  let replacement = lifecycle.replacement;
  if (replacement === undefined) {
    replacement = record.replacement;
  }
  if (replacement === undefined) {
    replacement = record.retirementOrMigration;
  }

  const required = status === "transitioning" || status === "retired";
  if (replacement === undefined || replacement === null || typeof replacement !== "object") {
    if (required) {
      addCode(errors, "missing_replacement_metadata");
    }
    return { required, declared: false, available: null, targetId: null, targetUrl: null };
  }

  const available = replacement.available;
  if (typeof available !== "boolean") {
    addCode(errors, "replacement_availability_missing");
  }

  let targetId = null;
  if (typeof replacement.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(replacement.id)) {
    targetId = replacement.id;
  }
  let urlValue = replacement.url;
  if (urlValue === undefined) {
    urlValue = replacement.migrationUrl;
  }
  if (urlValue === undefined) {
    urlValue = replacement.migration_url;
  }
  const targetUrl = safePublicUrl(urlValue, errors, "replacement_url");

  if (available === true && targetId === null && targetUrl === null) {
    addCode(errors, "replacement_target_missing");
  }
  if (available === false) {
    if (typeof replacement.reason !== "string" || replacement.reason.trim().length < 3) {
      addCode(errors, "replacement_unavailable_reason_missing");
    }
    if (status === "transitioning") {
      addCode(warnings, "transition_has_no_available_replacement");
    }
  }
  if (!required) {
    addCode(warnings, "replacement_metadata_on_non_transition_record");
  }

  return { required, declared: true, available, targetId, targetUrl };
}

function imagePinPolicy(reference, warnings) {
  if (reference === null) {
    return "not-observed";
  }
  if (/\$\{[^}]+\}/.test(reference)) {
    addCode(warnings, "unresolved_image_reference");
    return "unresolved";
  }
  if (/@sha256:[a-f0-9]{64}$/i.test(reference)) {
    return "digest";
  }

  const finalSegment = reference.slice(reference.lastIndexOf("/") + 1);
  const colon = finalSegment.lastIndexOf(":");
  if (colon < 0) {
    addCode(warnings, "implicit_latest_image_tag");
    return "floating";
  }
  const tag = finalSegment.slice(colon + 1);
  if (/^(?:latest|stable|current|edge|nightly|main|master|dev|develop|canary)$/i.test(tag)) {
    addCode(warnings, "mutable_channel_image_tag");
    return "floating";
  }
  if (/^v?\d+(?:\.\d+)?$/.test(tag)) {
    addCode(warnings, "broad_version_image_tag");
    return "floating-version";
  }
  if (/^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(tag)) {
    return "exact-version";
  }
  addCode(warnings, "unclassified_mutable_image_tag");
  return "unknown";
}

function imageRecord(record, errors, warnings) {
  let reference = null;
  let source = null;
  let status = null;
  let provenanceUrl = null;
  const image = record.image;

  if (typeof image === "string") {
    reference = image;
    const provenance = record.imageProvenance ?? record.image_provenance;
    if (provenance !== null && typeof provenance === "object") {
      source = provenance.source;
      provenanceUrl = provenance.url ?? provenance.sourceUrl ?? provenance.source_url;
    }
  } else if (image !== null && typeof image === "object") {
    reference = image.reference ?? null;
    source = image.source ?? null;
    status = image.status ?? null;
    provenanceUrl = image.provenanceUrl ?? image.provenance_url ?? image.sourceUrl ?? image.source_url;
  }

  if (reference !== null && typeof reference !== "string") {
    addCode(errors, "invalid_image_reference");
    reference = null;
  }
  if (typeof reference === "string" && /:\/\/[^\s/@]+:[^\s/@]+@/.test(reference)) {
    addCode(errors, "image_reference_contains_credentials");
    reference = "[REDACTED]";
  }

  if (reference !== null) {
    if (typeof source !== "string" || !VALID_IMAGE_SOURCES.has(source)) {
      addCode(errors, "missing_or_invalid_image_provenance_source");
      source = "unknown";
    } else if (source === "unknown") {
      addCode(warnings, "image_provenance_unverified");
    }
    if (status === null) {
      addCode(warnings, "image_provenance_status_missing");
    }
  }

  const safeProvenanceUrl = safePublicUrl(provenanceUrl, errors, "image_provenance_url");
  if (reference !== null && source !== "unknown" && safeProvenanceUrl === null) {
    addCode(warnings, "image_provenance_url_missing");
  }

  const pinPolicy = imagePinPolicy(reference, warnings);
  return { reference, source, status, provenanceUrl: safeProvenanceUrl, pinPolicy };
}

function sourceCount(record, lifecycle, errors) {
  const candidates = [];
  if (Array.isArray(record.sources)) {
    candidates.push(...record.sources);
  }
  candidates.push(lifecycle.sourceUrl, lifecycle.source_url, lifecycle.evidenceUrl, lifecycle.evidence_url);
  if (record.upstream !== null && typeof record.upstream === "object") {
    candidates.push(record.upstream.url, record.upstream.repository, record.upstream.docs);
  }

  let count = 0;
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) {
      continue;
    }
    const safe = safePublicUrl(candidate, errors, "lifecycle_source_url");
    if (safe !== null) {
      count += 1;
    }
  }
  if (count === 0) {
    addCode(errors, "missing_lifecycle_source");
  }
  return count;
}

function validateRecord(record, options, now) {
  const errors = [];
  const warnings = [];
  if (record === null || Array.isArray(record) || typeof record !== "object") {
    return {
      id: "unknown",
      status: "blocked",
      valid: false,
      lifecycleStatus: null,
      checkedAt: null,
      ageDays: null,
      replacement: { required: false, declared: false, available: null, targetId: null, targetUrl: null },
      image: { reference: null, source: null, status: null, provenanceUrl: null, pinPolicy: "not-observed" },
      sourceCount: 0,
      errors: ["record_must_be_object"],
      warnings: [],
    };
  }

  const id = safeId(record.id, errors);
  let lifecycle = record.lifecycle;
  if (lifecycle === undefined) {
    lifecycle = record;
  }
  if (lifecycle === null || typeof lifecycle !== "object") {
    lifecycle = {};
    addCode(errors, "missing_lifecycle_metadata");
  }

  const lifecycleStatus = lifecycle.status;
  if (typeof lifecycleStatus !== "string" || !VALID_STATUSES.has(lifecycleStatus)) {
    addCode(errors, "missing_or_invalid_lifecycle_status");
  }

  let checkedAtValue = lifecycle.checkedAt;
  if (checkedAtValue === undefined) {
    checkedAtValue = lifecycle.checked_at;
  }
  const checked = checkedDate(checkedAtValue, errors);
  let ageDays = null;
  if (checked.timestamp !== null) {
    ageDays = Math.floor((now - checked.timestamp) / 86_400_000);
    if (ageDays < -1) {
      addCode(errors, "checked_at_in_future");
    } else if (ageDays > options.maxAgeDays) {
      addCode(warnings, "lifecycle_check_stale");
    }
  }

  const sources = sourceCount(record, lifecycle, errors);
  const replacement = replacementRecord(record, lifecycle, errors, warnings, lifecycleStatus);
  const image = imageRecord(record, errors, warnings);

  if (lifecycleStatus === "retired" && image.reference !== null) {
    addCode(warnings, "retired_record_retains_image_reference");
  }
  if (lifecycleStatus === "verify") {
    addCode(warnings, "lifecycle_requires_fresh_verification");
  }

  if (options.strict && warnings.length > 0) {
    addCode(errors, "strict_mode_rejects_warnings");
  }

  let status = "pass";
  if (errors.length > 0) {
    status = "blocked";
  } else if (warnings.length > 0) {
    status = "warn";
  }

  return {
    id,
    status,
    valid: errors.length === 0,
    lifecycleStatus,
    checkedAt: checked.value,
    ageDays,
    replacement,
    image,
    sourceCount: sources,
    errors,
    warnings,
  };
}

function safeFailure(code, pretty) {
  const result = { status: "blocked", valid: false, records: [], errors: [code] };
  let spacing = 0;
  if (pretty) {
    spacing = 2;
  }
  process.stdout.write(`${JSON.stringify(result, null, spacing)}\n`);
  process.exitCode = 1;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    safeFailure(error.message, false);
    return;
  }

  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  let raw;
  try {
    raw = await readInput(options.file);
  } catch (error) {
    let reason = "input_unavailable";
    if (error.message === "input_too_large") {
      reason = error.message;
    }
    safeFailure(reason, options.pretty);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeFailure("invalid_json", options.pretty);
    return;
  }

  let records = parsed;
  if (!Array.isArray(records) && parsed !== null && typeof parsed === "object" && Array.isArray(parsed.records)) {
    records = parsed.records;
  }
  if (!Array.isArray(records)) {
    records = [records];
  }
  if (records.length === 0) {
    safeFailure("no_records", options.pretty);
    return;
  }

  const now = Date.now();
  const results = records.map((record) => validateRecord(record, options, now));
  const blocked = results.filter((record) => record.status === "blocked").length;
  const warned = results.filter((record) => record.status === "warn").length;
  let status = "pass";
  if (blocked > 0) {
    status = "blocked";
  } else if (warned > 0) {
    status = "warn";
  }

  const result = {
    status,
    valid: blocked === 0,
    summary: { total: results.length, passed: results.length - blocked - warned, warned, blocked },
    records: results,
  };
  let spacing = 0;
  if (options.pretty) {
    spacing = 2;
  }
  process.stdout.write(`${JSON.stringify(result, null, spacing)}\n`);
  if (blocked > 0) {
    process.exitCode = 1;
  }
}

await main();
