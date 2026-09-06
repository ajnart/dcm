#!/usr/bin/env bun

import { readFile } from "node:fs/promises";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const SECRET_QUERY = /(?:pass(?:word|phrase)?|secret|token|api[-_.]?key|access[-_.]?key|private[-_.]?key|client[-_.]?secret|credential|authorization|cookie|session)/i;
const SOFT_404_TITLE = /(?:^|\b)(?:404|not[ -]?found|page unavailable|page missing|does not exist|could not be found)(?:\b|$)/i;

function usage() {
  return "Usage: bun validate-link-result.ts [--file FILE] [--pretty]";
}

function parseArgs(argv) {
  const options = { file: null, pretty: false, help: false };
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

function parsePublicUrl(value, reasons, fieldCode) {
  if (typeof value !== "string" || value.length === 0) {
    addCode(reasons, `missing_${fieldCode}`);
    return null;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    addCode(reasons, `invalid_${fieldCode}`);
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    addCode(reasons, `invalid_${fieldCode}_scheme`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    addCode(reasons, `${fieldCode}_contains_credentials`);
    parsed.username = "REDACTED";
    parsed.password = "";
  }
  for (const name of Array.from(parsed.searchParams.keys())) {
    if (!SECRET_QUERY.test(name)) {
      continue;
    }
    addCode(reasons, `${fieldCode}_contains_secret_query`);
    parsed.searchParams.set(name, "REDACTED");
  }
  return parsed;
}

function comparable(url) {
  if (url === null) {
    return null;
  }
  const copy = new URL(url.toString());
  copy.hash = "";
  return copy.toString();
}

function normalizedPath(pathname) {
  let result = pathname;
  result = result.replace(/\/\.md$/i, "/");
  result = result.replace(/\.md$/i, "");
  if (result.length > 1 && result.endsWith("/")) {
    result = result.slice(0, -1);
  }
  return result;
}

function isMarkdownMutation(source, candidate) {
  if (source === null || candidate === null) {
    return false;
  }
  if (source.origin !== candidate.origin) {
    return false;
  }
  if (!/(?:\/\.md|\.md)$/i.test(candidate.pathname)) {
    return false;
  }
  return normalizedPath(source.pathname) === normalizedPath(candidate.pathname);
}

function statusFrom(input, readResult) {
  const candidates = [
    input.httpStatus,
    input.http_status,
    input.statusCode,
    readResult?.httpStatus,
    readResult?.statusCode,
    readResult?.data?.httpStatus,
    readResult?.data?.statusCode,
    readResult?.data?.status,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isInteger(numeric) && numeric >= 100 && numeric <= 599) {
      return numeric;
    }
  }

  const error = readResult?.error;
  if (typeof error === "string") {
    const match = error.match(/HTTP\s+([1-5][0-9]{2})/i);
    if (match !== null) {
      return Number(match[1]);
    }
  }
  return null;
}

function finalUrlFrom(input, readResult) {
  const candidates = [
    input.finalUrl,
    input.final_url,
    readResult?.finalUrl,
    readResult?.url,
    readResult?.data?.finalUrl,
    readResult?.data?.url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

function redirectUrls(input, readResult) {
  let source = input.redirects;
  if (!Array.isArray(source)) {
    source = readResult?.data?.redirects;
  }
  if (!Array.isArray(source)) {
    return [];
  }
  const values = [];
  for (const entry of source) {
    if (typeof entry === "string") {
      values.push(entry);
      continue;
    }
    if (entry !== null && typeof entry === "object") {
      if (typeof entry.url === "string") {
        values.push(entry.url);
      } else if (typeof entry.location === "string") {
        values.push(entry.location);
      }
    }
  }
  return values;
}

function validTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function validateEnvelope(input) {
  const reasons = [];
  const warnings = [];
  let readResult = input.read;
  if (readResult === undefined) {
    readResult = input.result;
  }
  if (readResult === undefined && typeof input.success === "boolean") {
    readResult = input;
  }
  if (readResult === undefined || readResult === null || typeof readResult !== "object") {
    readResult = {};
    addCode(reasons, "missing_read_json");
  }

  let checkedAt = input.checkedAt;
  if (checkedAt === undefined) {
    checkedAt = input.checked_at;
  }
  if (!validTimestamp(checkedAt)) {
    addCode(reasons, "missing_or_invalid_checked_at");
    checkedAt = null;
  }

  const sourceValue = input.sourceUrl ?? input.source_url;
  const canonicalValue = input.canonicalUrl ?? input.canonical_url;
  const finalValue = finalUrlFrom(input, readResult);
  const source = parsePublicUrl(sourceValue, reasons, "source_url");
  const canonical = parsePublicUrl(canonicalValue, reasons, "canonical_url");
  const final = parsePublicUrl(finalValue, reasons, "final_url");

  const httpStatus = statusFrom(input, readResult);
  if (httpStatus === null) {
    addCode(reasons, "missing_http_status");
  } else if (httpStatus < 200 || httpStatus >= 300) {
    addCode(reasons, "non_2xx_http_status");
  }
  if (readResult.success !== true) {
    addCode(reasons, "read_json_not_successful");
  }

  const wait = input.wait;
  let waitKind = null;
  let waitCompleted = false;
  if (wait !== null && typeof wait === "object") {
    waitCompleted = wait.completed === true;
    if (typeof wait.kind === "string" && wait.kind.length > 0) {
      waitKind = wait.kind;
    } else if (typeof wait.condition === "string" && wait.condition.length > 0) {
      waitKind = wait.condition;
    }
  }
  if (!waitCompleted || waitKind === null) {
    addCode(reasons, "missing_wait_evidence");
  }

  const evidence = input.evidence;
  let titleCaptured = false;
  let contentEvidence = false;
  let soft404Checked = false;
  let observedTitle = null;
  if (evidence !== null && typeof evidence === "object") {
    titleCaptured = evidence.titleCaptured === true;
    contentEvidence = evidence.contentMarkerCaptured === true || evidence.outlineCaptured === true || evidence.snapshotCaptured === true;
    soft404Checked = evidence.soft404Checked === true;
    if (typeof evidence.title === "string") {
      observedTitle = evidence.title;
    }
  }
  if (!titleCaptured) {
    addCode(reasons, "missing_title_evidence");
  }
  if (!contentEvidence) {
    addCode(reasons, "missing_content_evidence");
  }
  if (!soft404Checked) {
    addCode(reasons, "soft_404_not_checked");
  }

  if (observedTitle === null && typeof readResult?.data?.title === "string") {
    observedTitle = readResult.data.title;
  }
  if (observedTitle !== null && SOFT_404_TITLE.test(observedTitle.slice(0, 200))) {
    addCode(reasons, "soft_404_detected");
  }
  const contentSample = evidence?.contentSample ?? readResult?.data?.content;
  if (typeof contentSample === "string") {
    const prefix = contentSample.slice(0, 320);
    if (/^(?:\s*#?\s*)?(?:404|page not found|not found|page unavailable)\b/i.test(prefix)) {
      addCode(reasons, "soft_404_detected");
    }
  }

  const sourceComparable = comparable(source);
  const canonicalComparable = comparable(canonical);
  const finalComparable = comparable(final);
  const markdownMutation = isMarkdownMutation(canonical ?? source, final);
  const fallback = input.markdownFallback ?? input.markdown_fallback;
  let fallbackRecorded = false;
  if (fallback !== null && typeof fallback === "object") {
    fallbackRecorded = fallback.used === true && fallback.recorded === true;
    if (fallbackRecorded && typeof fallback.canonicalUrl !== "string") {
      addCode(reasons, "markdown_fallback_canonical_missing");
    } else if (fallbackRecorded && canonicalComparable !== null) {
      const fallbackCanonical = parsePublicUrl(fallback.canonicalUrl, reasons, "markdown_fallback_canonical_url");
      if (comparable(fallbackCanonical) !== canonicalComparable) {
        addCode(reasons, "markdown_fallback_canonical_mismatch");
      }
    }
  }
  if (markdownMutation && !fallbackRecorded) {
    addCode(reasons, "unrecorded_markdown_fallback_mutation");
  }
  if (markdownMutation && fallbackRecorded) {
    addCode(warnings, "recorded_markdown_fallback_mutation");
  }

  const redirectValues = redirectUrls(input, readResult);
  const safeRedirects = [];
  for (const value of redirectValues) {
    const parsed = parsePublicUrl(value, reasons, "redirect_url");
    if (parsed !== null) {
      safeRedirects.push(parsed);
    }
  }

  let redirectDetected = false;
  if (sourceComparable !== null && finalComparable !== null && sourceComparable !== finalComparable && !markdownMutation) {
    redirectDetected = true;
  }
  if (redirectDetected && safeRedirects.length === 0) {
    addCode(reasons, "unrecorded_redirect");
  }
  if (redirectDetected && safeRedirects.length > 0) {
    const lastRedirect = safeRedirects[safeRedirects.length - 1];
    if (comparable(lastRedirect) !== finalComparable) {
      addCode(reasons, "redirect_chain_final_url_mismatch");
    } else {
      addCode(warnings, "recorded_redirect");
    }
  }

  if (sourceComparable !== null && canonicalComparable !== null && sourceComparable !== canonicalComparable) {
    const explainedByRedirect = safeRedirects.some((url) => comparable(url) === canonicalComparable);
    const explainedByFallback = isMarkdownMutation(source, canonical) && fallbackRecorded;
    if (!explainedByRedirect && !explainedByFallback) {
      addCode(reasons, "canonical_url_mutation_unrecorded");
    }
  }

  let status = "pass";
  if (reasons.length > 0) {
    status = "blocked";
  } else if (warnings.length > 0) {
    status = "warn";
  }

  return {
    status,
    valid: reasons.length === 0,
    checkedAt,
    sourceUrl: source?.toString() ?? null,
    canonicalUrl: canonical?.toString() ?? null,
    finalUrl: final?.toString() ?? null,
    httpStatus,
    redirect: { detected: redirectDetected, recorded: safeRedirects.length > 0, hops: safeRedirects.length },
    markdownFallback: { detected: markdownMutation, recorded: fallbackRecorded },
    wait: { completed: waitCompleted, kind: waitKind },
    evidence: { titleCaptured, contentEvidence, soft404Checked },
    reasons,
    warnings,
  };
}

function safeFailure(code, pretty) {
  const result = { status: "blocked", valid: false, reasons: [code], warnings: [] };
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
    options = parseArgs(Bun.argv.slice(2));
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

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    safeFailure("invalid_json", options.pretty);
    return;
  }
  if (input === null || Array.isArray(input) || typeof input !== "object") {
    safeFailure("input_must_be_object", options.pretty);
    return;
  }

  const result = validateEnvelope(input);
  let spacing = 0;
  if (options.pretty) {
    spacing = 2;
  }
  process.stdout.write(`${JSON.stringify(result, null, spacing)}\n`);
  if (!result.valid) {
    process.exitCode = 1;
  }
}

await main();
