/** Container-readable configuration may reference only declared bcrypt hashes,
 * in a bounded weak-quoted user/password directive; never arbitrary env values.
 */
export function containerHashReferencesAllowed(content: string, names: Set<string>): boolean {
  for (const line of content.split("\n")) {
    if (!line.includes("$")) continue;
    const reference = /^\s*user [a-z][a-z0-9_-]* password "\$([A-Z][A-Z0-9_]*_AUTH_HASH)"\s*$/.exec(line);
    if (!reference || !names.has(reference[1])) return false;
  }
  return true;
}

/** Dynamic files may substitute declared bcrypt hashes only, never evaluate
 * arbitrary Go-template expressions or resolve other environment values. */
export function bcryptHashTemplateReferencesAllowed(content: string, names: Set<string>): boolean {
  let valid = true;
  const literal = content.replace(/\{\{\s*env\s+"([A-Z][A-Z0-9_]*_AUTH_HASH)"\s*\}\}/g, (_token, name: string) => {
    if (!names.has(name)) valid = false;
    return "";
  });
  return valid && !/\{\{|\}\}/.test(literal);
}
