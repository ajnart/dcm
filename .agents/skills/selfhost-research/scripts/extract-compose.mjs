#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const SECRET_NAME = /(?:pass(?:word|phrase)?|passwd|pwd|secret|token|api[-_.]?key|access[-_.]?key|private[-_.]?key|client[-_.]?secret|encryption[-_.]?key|credential|authorization|cookie|session[-_.]?(?:id|key|token))/i;

function usage() {
  return "Usage: node extract-compose.mjs [--file FILE] [--pretty]";
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

function stripComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      if (quote === character) {
        quote = null;
      } else if (quote === null) {
        quote = character;
      }
      continue;
    }
    if (character === "#" && quote === null) {
      if (index === 0 || /\s/.test(line[index - 1])) {
        return line.slice(0, index).trimEnd();
      }
    }
  }
  return line.trimEnd();
}

function indentation(line) {
  const match = line.match(/^ */);
  return match[0].length;
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function addLimitation(target, code) {
  if (!target.limitations.includes(code)) {
    target.limitations.push(code);
  }
}

function splitColon(value) {
  const parts = [];
  let buffer = "";
  let squareDepth = 0;
  let braceDepth = 0;
  for (const character of value) {
    if (character === "[") {
      squareDepth += 1;
    } else if (character === "]" && squareDepth > 0) {
      squareDepth -= 1;
    } else if (character === "{") {
      braceDepth += 1;
    } else if (character === "}" && braceDepth > 0) {
      braceDepth -= 1;
    }

    if (character === ":" && squareDepth === 0 && braceDepth === 0) {
      parts.push(buffer);
      buffer = "";
      continue;
    }
    buffer += character;
  }
  parts.push(buffer);
  return parts;
}

function safeScalar(value) {
  const scalar = unquote(stripComment(value));
  if (scalar.length === 0) {
    return null;
  }
  if (/\r|\n/.test(scalar)) {
    return null;
  }
  if (/\b(?:https?|docker):\/\/[^\s/@]+:[^\s/@]+@/i.test(scalar)) {
    return "[REDACTED]";
  }
  return scalar;
}

function parseShortPort(value) {
  let scalar = safeScalar(value);
  if (scalar === null || scalar === "[REDACTED]") {
    return null;
  }

  let protocol = "tcp";
  const slash = scalar.lastIndexOf("/");
  if (slash > 0) {
    protocol = scalar.slice(slash + 1);
    scalar = scalar.slice(0, slash);
  }

  const parts = splitColon(scalar);
  const port = { target: null, published: null, hostIp: null, protocol, mode: null };
  if (parts.length === 1) {
    port.target = parts[0];
    return port;
  }

  port.target = parts[parts.length - 1];
  port.published = parts[parts.length - 2];
  if (parts.length > 2) {
    port.hostIp = parts.slice(0, -2).join(":");
    port.hostIp = port.hostIp.replace(/^\[/, "").replace(/\]$/, "");
  }
  return port;
}

function inferVolumePurpose(target) {
  const lower = target.toLowerCase();
  if (/(?:^|\/)(?:config|appdata|configuration)(?:\/|$)/.test(lower)) {
    return "config";
  }
  if (/(?:^|\/)(?:cache|transcode|tmp)(?:\/|$)/.test(lower)) {
    return "cache";
  }
  if (/(?:^|\/)(?:download|downloads|torrents|usenet)(?:\/|$)/.test(lower)) {
    return "downloads";
  }
  if (/(?:^|\/)(?:data|media|movies|tv|photos|uploads|documents)(?:\/|$)/.test(lower)) {
    return "user-data";
  }
  if (/(?:^|\/)(?:backup|backups)(?:\/|$)/.test(lower)) {
    return "backup";
  }
  if (/(?:^|\/)(?:run\/secrets|secrets)(?:\/|$)/.test(lower)) {
    return "secret-mount";
  }
  return "unknown";
}

function parseShortVolume(value) {
  const scalar = safeScalar(value);
  if (scalar === null || scalar === "[REDACTED]") {
    return null;
  }
  const parts = splitColon(scalar);
  let target = parts[0];
  let readOnly = false;

  if (parts.length >= 2) {
    target = parts[parts.length - 1];
    if (/^(?:ro|rw|z|Z|cached|delegated|consistent)(?:,.*)?$/.test(target)) {
      readOnly = /(?:^|,)ro(?:,|$)/.test(target);
      target = parts[parts.length - 2];
    }
  }

  if (!target.startsWith("/") && !target.startsWith("${")) {
    return null;
  }
  return { target, purpose: inferVolumePurpose(target), readOnly };
}

function classifyEnvironment(name, value) {
  if (value === null || value.length === 0) {
    return "unset";
  }
  if (name.endsWith("_FILE") || /\/run\/secrets\//i.test(value) || /^!secret\b/i.test(value)) {
    return "secret-reference";
  }
  if (/^\$\{[^}]+\}$/.test(value)) {
    if (SECRET_NAME.test(name)) {
      return "secret-reference";
    }
    return "external-reference";
  }
  if (SECRET_NAME.test(name)) {
    return "literal-secret";
  }
  return "literal-non-secret";
}

function addEnvironment(service, name, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    addLimitation(service, "unsupported_environment_name");
    return;
  }
  const secretRefStatus = classifyEnvironment(name, value);
  if (secretRefStatus === "literal-secret") {
    addLimitation(service, "literal_secret_environment_value_present");
  }
  const existing = service.environment.find((item) => item.name === name);
  if (existing !== undefined) {
    existing.secretRefStatus = secretRefStatus;
    return;
  }
  service.environment.push({ name, secretRefStatus });
}

function imageRegistry(reference) {
  if (reference === null || reference === "[REDACTED]") {
    return null;
  }
  const withoutDigest = reference.split("@")[0];
  const first = withoutDigest.split("/")[0];
  if (first.includes(".") || first.includes(":") || first === "localhost") {
    return first;
  }
  return "docker.io";
}

function createService(name) {
  return {
    service: name,
    image: null,
    ports: [],
    volumeTargets: [],
    environment: [],
    health: { configured: false, disabled: false },
    networks: [],
    networkMode: null,
    restart: null,
    init: null,
    provenance: {
      upstreamProjectUrl: null,
      imageSource: "unknown",
      imageSourceUrl: null,
      imageRegistry: null,
      sourceUrl: null,
    },
    confidence: "high",
    limitations: [],
  };
}

function setConfidence(service) {
  if (service.limitations.length === 0) {
    service.confidence = "high";
    return;
  }
  const severe = service.limitations.some((item) => item.startsWith("unsupported_") || item.includes("secret"));
  if (severe) {
    service.confidence = "low";
    return;
  }
  service.confidence = "medium";
}

function normalizeService(service) {
  service.ports = service.ports.filter((port) => port.target !== null && port.target.length > 0);
  service.volumeTargets = service.volumeTargets.filter((volume) => volume.target.length > 0);
  service.networks = Array.from(new Set(service.networks));
  service.environment.sort((left, right) => left.name.localeCompare(right.name));
  service.provenance.imageRegistry = imageRegistry(service.image);
  if (service.image === null) {
    addLimitation(service, "image_not_observed");
  }
  setConfidence(service);
  return service;
}

function extractCompose(input) {
  const global = { limitations: [] };
  const services = [];
  const lines = input.split(/\r?\n/);
  let servicesIndent = null;
  let current = null;
  let currentIndent = null;
  let section = null;
  let sectionIndent = null;
  let longPort = null;
  let longVolume = null;

  function flushPort() {
    if (current !== null && longPort !== null) {
      current.ports.push(longPort);
    }
    longPort = null;
  }

  function flushVolume() {
    if (current !== null && longVolume !== null && longVolume.target !== null) {
      longVolume.purpose = inferVolumePurpose(longVolume.target);
      current.volumeTargets.push(longVolume);
    }
    longVolume = null;
  }

  function flushSectionItems() {
    flushPort();
    flushVolume();
  }

  function flushService() {
    flushSectionItems();
    if (current !== null) {
      services.push(normalizeService(current));
    }
    current = null;
    currentIndent = null;
    section = null;
    sectionIndent = null;
  }

  for (const rawLine of lines) {
    if (rawLine.includes("\t")) {
      addLimitation(global, "tabs_not_supported");
    }
    const line = stripComment(rawLine.replace(/\t/g, "  "));
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
      continue;
    }
    const indent = indentation(line);
    const trimmed = line.trim();

    if (servicesIndent === null) {
      const servicesMatch = trimmed.match(/^services:\s*(.*)$/);
      if (servicesMatch === null) {
        continue;
      }
      servicesIndent = indent;
      if (servicesMatch[1].length > 0) {
        addLimitation(global, "inline_services_not_supported");
      }
      continue;
    }

    if (indent <= servicesIndent) {
      flushService();
      break;
    }

    const serviceMatch = trimmed.match(/^([A-Za-z0-9][A-Za-z0-9._-]*):\s*$/);
    if (indent === servicesIndent + 2 && serviceMatch !== null) {
      flushService();
      current = createService(serviceMatch[1]);
      currentIndent = indent;
      continue;
    }

    if (current === null || indent <= currentIndent) {
      continue;
    }

    if (/^(?:<<:|extends:)/.test(trimmed) || /(?:^|\s)[&*][A-Za-z0-9_-]+/.test(trimmed)) {
      addLimitation(current, "unsupported_yaml_anchor_or_extension");
    }

    if (indent === currentIndent + 2) {
      flushSectionItems();
      section = null;
      sectionIndent = null;
      const property = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (property === null) {
        addLimitation(current, "unsupported_service_property");
        continue;
      }
      const key = property[1];
      const value = property[2];

      if (key === "image") {
        current.image = safeScalar(value);
        if (current.image === "[REDACTED]") {
          addLimitation(current, "image_reference_redacted");
        }
        continue;
      }
      if (["ports", "volumes", "environment", "healthcheck", "networks"].includes(key)) {
        section = key;
        sectionIndent = indent;
        if (key === "healthcheck") {
          current.health.configured = true;
        }
        if (value.length > 0 && value !== "[]" && value !== "{}") {
          addLimitation(current, `unsupported_inline_${key}`);
          if (key === "healthcheck") {
            current.health.configured = true;
            if (/disable\s*:\s*true/i.test(value) || /NONE/i.test(value)) {
              current.health.disabled = true;
            }
          }
        }
        continue;
      }
      if (key === "restart") {
        current.restart = safeScalar(value);
        continue;
      }
      if (key === "init") {
        const normalized = safeScalar(value);
        if (normalized === "true") {
          current.init = true;
        } else if (normalized === "false") {
          current.init = false;
        } else {
          addLimitation(current, "unsupported_init_value");
        }
        continue;
      }
      if (key === "network_mode") {
        current.networkMode = safeScalar(value);
        continue;
      }
      if (key === "env_file") {
        addLimitation(current, "env_file_not_expanded");
      }
      continue;
    }

    if (section === null || indent <= sectionIndent) {
      continue;
    }

    if (section === "ports") {
      const listItem = trimmed.match(/^-\s*(.*)$/);
      if (listItem !== null && indent === sectionIndent + 2) {
        flushPort();
        const item = listItem[1];
        const longStart = item.match(/^(target|published|host_ip|protocol|mode):\s*(.+)$/);
        if (longStart !== null) {
          longPort = { target: null, published: null, hostIp: null, protocol: "tcp", mode: null };
          let name = longStart[1];
          if (name === "host_ip") {
            name = "hostIp";
          }
          longPort[name] = safeScalar(longStart[2]);
        } else {
          const port = parseShortPort(item);
          if (port === null) {
            addLimitation(current, "unsupported_port_entry");
          } else {
            current.ports.push(port);
          }
        }
        continue;
      }
      if (longPort !== null) {
        const field = trimmed.match(/^(target|published|host_ip|protocol|mode):\s*(.+)$/);
        if (field !== null) {
          let name = field[1];
          if (name === "host_ip") {
            name = "hostIp";
          }
          longPort[name] = safeScalar(field[2]);
        }
      }
      continue;
    }

    if (section === "volumes") {
      const listItem = trimmed.match(/^-\s*(.*)$/);
      if (listItem !== null && indent === sectionIndent + 2) {
        flushVolume();
        const item = listItem[1];
        const longStart = item.match(/^(type|source|target|read_only):\s*(.+)$/);
        if (longStart !== null) {
          longVolume = { target: null, purpose: "unknown", readOnly: false };
          if (longStart[1] === "target") {
            longVolume.target = safeScalar(longStart[2]);
          }
          if (longStart[1] === "read_only") {
            longVolume.readOnly = longStart[2].toLowerCase() === "true";
          }
        } else {
          const volume = parseShortVolume(item);
          if (volume === null) {
            addLimitation(current, "unsupported_volume_entry");
          } else {
            current.volumeTargets.push(volume);
          }
        }
        continue;
      }
      if (longVolume !== null) {
        const target = trimmed.match(/^target:\s*(.+)$/);
        if (target !== null) {
          longVolume.target = safeScalar(target[1]);
          continue;
        }
        const readOnly = trimmed.match(/^read_only:\s*(true|false)$/i);
        if (readOnly !== null) {
          longVolume.readOnly = readOnly[1].toLowerCase() === "true";
        }
      }
      continue;
    }

    if (section === "environment") {
      if (indent !== sectionIndent + 2) {
        addLimitation(current, "unsupported_nested_environment_entry");
        continue;
      }
      const listItem = trimmed.match(/^-\s*([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/);
      if (listItem !== null) {
        let value = null;
        if (listItem[2] !== undefined) {
          value = listItem[2].trim();
        }
        addEnvironment(current, listItem[1], value);
        continue;
      }
      const mapping = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*):(?:\s*(.*))?$/);
      if (mapping !== null) {
        let value = null;
        if (mapping[2] !== undefined) {
          value = mapping[2].trim();
        }
        addEnvironment(current, mapping[1], value);
      } else {
        addLimitation(current, "unsupported_environment_entry");
      }
      continue;
    }

    if (section === "healthcheck") {
      current.health.configured = true;
      if (/^disable:\s*true$/i.test(trimmed) || /^test:.*\bNONE\b/i.test(trimmed)) {
        current.health.disabled = true;
      }
      continue;
    }

    if (section === "networks") {
      if (indent !== sectionIndent + 2) {
        continue;
      }
      const listItem = trimmed.match(/^-\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/);
      if (listItem !== null) {
        current.networks.push(listItem[1]);
        continue;
      }
      const mapping = trimmed.match(/^([A-Za-z0-9][A-Za-z0-9._-]*):(?:\s*.*)?$/);
      if (mapping !== null) {
        current.networks.push(mapping[1]);
      } else {
        addLimitation(current, "unsupported_network_entry");
      }
    }
  }

  flushService();
  if (servicesIndent === null) {
    addLimitation(global, "services_section_not_found");
  }
  if (services.length === 0) {
    addLimitation(global, "no_services_extracted");
  }

  let confidence = "high";
  if (global.limitations.length > 0 || services.some((service) => service.confidence === "low")) {
    confidence = "low";
  } else if (services.some((service) => service.confidence === "medium")) {
    confidence = "medium";
  }

  let status = "pass";
  if (services.length === 0) {
    status = "blocked";
  } else if (global.limitations.length > 0 || services.some((service) => service.limitations.length > 0)) {
    status = "warn";
  }

  return { status, services, confidence, limitations: global.limitations };
}

function safeFailure(code, pretty) {
  const result = { status: "blocked", services: [], confidence: "low", limitations: [code] };
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

  const result = extractCompose(input);
  let spacing = 0;
  if (options.pretty) {
    spacing = 2;
  }
  process.stdout.write(`${JSON.stringify(result, null, spacing)}\n`);
  if (result.status === "blocked") {
    process.exitCode = 1;
  }
}

await main();
