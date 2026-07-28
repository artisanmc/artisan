/**
 * Replace `{name}` and `{name.path.subfield}` occurrences in `template`
 * with values pulled from `context` by dotted-path lookup. Unresolved
 * placeholders are left as-is so the user sees what didn't bind.
 *
 * Used by the editor to render iteration previews (e.g. `{quest.name}`
 * resolved against a sampleContext item) and any other place where a
 * raw template string needs to display concrete values.
 */
export function resolvePlaceholders(template: string, context: Record<string, unknown>): string {
  if (!template.includes("{")) return template;
  return template.replace(/\{([^{}]+)\}/g, (whole, key: string) => {
    const value = lookupPath(context, key.trim());
    return value === undefined || value === null ? whole : String(value);
  });
}

/** Walk a dotted path through `obj`, returning the leaf value or undefined. */
export function lookupPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

