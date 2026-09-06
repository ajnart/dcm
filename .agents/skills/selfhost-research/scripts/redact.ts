#!/usr/bin/env bun

import { readFile } from "node:fs/promises";

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const SECRET_KEY = String.raw`(?:pass(?:word|phrase)?|passwd|pwd|secret|token|api[-_.]?key|access[-_.]?key|private[-_.]?key|client[-_.]?secret|encryption[-_.]?key|credential|authorization|auth[-_.]?token|cookie|session[-_.]?(?:id|key|token))`;
const SECRET_FIELD = String.raw`(?:${SECRET_KEY}|[A-Za-z_][A-Za-z0-9_.-]*${SECRET_KEY}[A-Za-z0-9_.-]*)`;

function usage() {
  return "Usage: bun redact.ts [--file FILE] [--pretty]";
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

function increment(counts, key, amount = 1) {
  if (amount === 0) {
    return;
  }
  if (counts[key] === undefined) {
    counts[key] = 0;
  }
  counts[key] += amount;
}

function replaceCounted(text, pattern, replacement, counts, category) {
  let count = 0;
  const output = text.replace(pattern, (...args) => {
    count += 1;
    if (typeof replacement === "function") {
      return replacement(...args);
    }
    return replacement;
  });
  increment(counts, category, count);
  return output;
}

function redactUrl(raw, counts) {
  let suffix = "";
  let candidate = raw;
  while (/[),.;]$/.test(candidate)) {
    suffix = candidate.slice(-1) + suffix;
    candidate = candidate.slice(0, -1);
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return raw;
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    parsed.username = "REDACTED";
    parsed.password = "";
    increment(counts, "urlCredentials");
  }

  const secretName = new RegExp(`^${SECRET_FIELD}$`, "i");
  for (const name of Array.from(parsed.searchParams.keys())) {
    if (!secretName.test(name)) {
      continue;
    }
    parsed.searchParams.set(name, "REDACTED");
    increment(counts, "urlQueryValues");
  }

  if (parsed.hash.length > 1 && secretName.test(parsed.hash.slice(1).split("=")[0])) {
    parsed.hash = "#REDACTED";
    increment(counts, "urlFragments");
  }

  return parsed.toString() + suffix;
}

function entropy(value) {
  const frequencies = new Map();
  for (const character of value) {
    const previous = frequencies.get(character) ?? 0;
    frequencies.set(character, previous + 1);
  }

  let result = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    result -= probability * Math.log2(probability);
  }
  return result;
}

function isHighEntropy(value) {
  if (value === "[REDACTED]" || value === "REDACTED") {
    return false;
  }
  if (/^(?:x+|0+|1+)$/i.test(value)) {
    return false;
  }

  let classes = 0;
  if (/[a-z]/.test(value)) {
    classes += 1;
  }
  if (/[A-Z]/.test(value)) {
    classes += 1;
  }
  if (/[0-9]/.test(value)) {
    classes += 1;
  }
  if (/[+/_=-]/.test(value)) {
    classes += 1;
  }

  const isLongHex = /^[a-f0-9]{32,}$/i.test(value);
  if (!isLongHex && classes < 2) {
    if (value.length < 32 || entropy(value) < 4.1) {
      return false;
    }
  }
  return entropy(value) >= 3.6;
}

function redactText(input) {
  const counts = {};
  let output = input;

  output = replaceCounted(
    output,
    /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g,
    "[REDACTED PRIVATE KEY]",
    counts,
    "privateKeys",
  );

  output = replaceCounted(
    output,
    /^(\s*)(authorization|proxy-authorization|cookie|set-cookie)(\s*:\s*).*$/gim,
    (_match, indentation, name, separator) => `${indentation}${name}${separator}[REDACTED]`,
    counts,
    "sensitiveHeaders",
  );

  output = replaceCounted(
    output,
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    (_match, scheme) => `${scheme} [REDACTED]`,
    counts,
    "authorizationValues",
  );

  output = replaceCounted(
    output,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    "[REDACTED JWT]",
    counts,
    "jwtValues",
  );

  output = output.replace(
    /\b(?:https?|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s<>"'`]+/gi,
    (url) => redactUrl(url, counts),
  );

  const jsonKeyPattern = new RegExp(
    `(["'])(${SECRET_FIELD})\\1(\\s*:\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^,\\s}\\]]+)`,
    "gi",
  );
  output = replaceCounted(
    output,
    jsonKeyPattern,
    (_match, quote, key, separator) => `${quote}${key}${quote}${separator}"[REDACTED]"`,
    counts,
    "secretKeyValues",
  );

  const assignmentPattern = new RegExp(
    `^(\\s*(?:export\\s+)?${SECRET_FIELD}\\s*=\\s*).*$`,
    "gim",
  );
  output = replaceCounted(
    output,
    assignmentPattern,
    (_match, prefix) => `${prefix}[REDACTED]`,
    counts,
    "secretAssignments",
  );

  const yamlPattern = new RegExp(
    `^(\\s*${SECRET_FIELD}\\s*:\\s*).*$`,
    "gim",
  );
  output = replaceCounted(
    output,
    yamlPattern,
    (_match, prefix) => `${prefix}[REDACTED]`,
    counts,
    "secretMappings",
  );

  let highEntropyCount = 0;
  output = output.replace(/[A-Za-z0-9+/_=-]{24,}/g, (value) => {
    if (!isHighEntropy(value)) {
      return value;
    }
    highEntropyCount += 1;
    return "[REDACTED HIGH-ENTROPY VALUE]";
  });
  increment(counts, "highEntropyValues", highEntropyCount);

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return { output, counts, total };
}

function safeFailure(code, pretty) {
  const result = { status: "blocked", reason: code };
  const spacing = pretty ? 2 : 0;
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

  let input;
  try {
    input = await readInput(options.file);
  } catch (error) {
    let reason = "input_unavailable";
    if (error.message === "input_too_large") {
      reason = error.message;
    }
    safeFailure(reason, options.pretty);
    return;
  }

  const redaction = redactText(input);
  let status = "pass";
  if (redaction.total > 0) {
    status = "redacted";
  }

  const result = {
    status,
    redacted: redaction.output,
    redactionCount: redaction.total,
    categories: redaction.counts,
  };
  const spacing = options.pretty ? 2 : 0;
  process.stdout.write(`${JSON.stringify(result, null, spacing)}\n`);
}

await main();
