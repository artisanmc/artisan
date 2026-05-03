export type TemplateSegment =
  | { kind: "literal"; text: string }
  | { kind: "expression"; text: string }
  | { kind: "i18n"; text: string };

const I18N_PREFIX = "i18n:";

/**
 * Split a template string into segments. The resulting array is consumed
 * by the template renderer:
 *  - "literal" → emitted as-is (will be PAPI-resolved + MM-parsed later)
 *  - "expression" → eval through the DSL
 *  - "i18n" → resolve via translation lookup (recursive)
 *
 * Brace matching respects parens and quoted strings inside the
 * expression so `{xs.join(", ")}` and `{a == "}" ? 1 : 2}` work.
 *
 * Tolerant: malformed (unmatched) braces fall through as literal text
 * rather than throwing — runtime philosophy is "never crash a menu".
 */
export function tokenizeTemplate(src: string): TemplateSegment[] {
  const out: TemplateSegment[] = [];
  let i = 0;
  let literalStart = 0;

  const flushLiteral = (end: number) => {
    if (end > literalStart) {
      out.push({ kind: "literal", text: src.slice(literalStart, end) });
    }
  };

  while (i < src.length) {
    if (src[i]! !== "{") {
      i++;
      continue;
    }

    // Find matching closing brace, respecting strings and parens.
    let depth = 1;
    let j = i + 1;
    let inString: '"' | "'" | null = null;
    while (j < src.length && depth > 0) {
      const ch = src[j]!;
      if (inString) {
        if (ch === "\\" && j + 1 < src.length) {
          j += 2;
          continue;
        }
        if (ch === inString) inString = null;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch as '"' | "'";
        j++;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth === 0) break;
      j++;
    }

    if (depth !== 0) {
      // Unmatched brace — treat rest of string as literal.
      i = src.length;
      break;
    }

    const content = src.slice(i + 1, j);
    if (content.length === 0) {
      // Empty braces {} — treat as literal.
      i = j + 1;
      continue;
    }

    flushLiteral(i);

    if (content.startsWith(I18N_PREFIX)) {
      out.push({ kind: "i18n", text: content.slice(I18N_PREFIX.length) });
    } else {
      out.push({ kind: "expression", text: content });
    }

    i = j + 1;
    literalStart = i;
  }

  flushLiteral(src.length);
  if (out.length === 0) out.push({ kind: "literal", text: src });

  return out;
}
