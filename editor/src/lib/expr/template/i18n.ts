const MAX_DEPTH = 5;
const I18N_RE = /\{i18n:([a-zA-Z0-9_.-]+)\}/g;

export interface I18nResolverOptions {
  /** Returns the raw template string for the key, or undefined if missing. */
  lookup: (key: string) => string | undefined;
}

/**
 * Recursively replace `{i18n:key}` substrings with the resolved
 * translation value. Cycle-detected (visiting set) and depth-limited
 * (max 5). A missing key keeps its `{i18n:key}` source visible — same rule as an
 * unbound identifier (ADR `expression-parity` §4). Cycles and
 * depth-exceeded insert visible ⚠️ markers — caller may surface them.
 */
export function resolveI18n(template: string, opts: I18nResolverOptions): string {
  return resolve(template, opts, new Set(), 0);
}

function resolve(
  template: string,
  opts: I18nResolverOptions,
  visiting: Set<string>,
  depth: number,
): string {
  if (depth > MAX_DEPTH) {
    return "⚠️ i18n depth exceeded";
  }
  return template.replace(I18N_RE, (whole, key: string) => {
    if (visiting.has(key)) {
      const chain = [...visiting, key].join("→");
      return `⚠️ i18n cycle: ${chain}`;
    }
    const raw = opts.lookup(key);
    if (raw === undefined) return whole;
    visiting.add(key);
    const resolved = resolve(raw, opts, visiting, depth + 1);
    visiting.delete(key);
    return resolved;
  });
}
