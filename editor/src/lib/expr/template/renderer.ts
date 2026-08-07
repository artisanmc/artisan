import type { AstNode } from "../ast";
import type { AstCache } from "../cache";
import { toStringValue } from "../coercion";
import { ParseError } from "../errors";
import { evaluate } from "../evaluator";
import { rootIdentifiers } from "../rootIdentifiers";
import type { Scope } from "../scope";
import { resolveI18n } from "./i18n";
import { tokenizeTemplate } from "./tokenizer";

export interface RenderOptions {
  scope: Scope;
  cache: AstCache;
  projectId: string;
  projectVersion: number;
  /** Translation lookup (raw template string for an i18n key, or undefined). */
  i18nLookup: (key: string) => string | undefined;
}

/**
 * Render a template string to its final user-facing string.
 *
 * Pipeline (cf. spec §3.1):
 *  1. Recursive {i18n:key} resolution (cycle detection, max depth 5)
 *  2. Tokenize into literal + expression segments
 *  3. Evaluate each expression segment via the cached AST + scope
 *  4. Concat
 *  5. Resolve outer-level %papi% tokens (those that survived in literals
 *     and any re-emitted from expressions)
 *
 * MiniMessage parsing is OUT of this function's scope — it happens
 * downstream where the rendered string is converted to React/Adventure
 * components for display.
 */
export function renderTemplate(template: string, opts: RenderOptions): string {
  const afterI18n = resolveI18n(template, { lookup: opts.i18nLookup });

  const segments = tokenizeTemplate(afterI18n);
  let out = "";
  for (const seg of segments) {
    if (seg.kind === "literal") {
      out += seg.text;
    } else if (seg.kind === "expression") {
      out += evalSegment(seg.text, opts);
    } else {
      const resolved = resolveI18n(`{i18n:${seg.text}}`, { lookup: opts.i18nLookup });
      out += resolved;
    }
  }

  out = out.replace(/%([a-z_][a-z0-9_]*)%/g, (whole, name: string) => {
    const v = opts.scope.papi(name);
    return v || whole;
  });

  return out;
}

function evalSegment(expr: string, opts: RenderOptions): string {
  let ast: AstNode;
  try {
    ast = opts.cache.get(opts.projectId, opts.projectVersion, expr);
  } catch (e) {
    if (e instanceof ParseError) {
      return `⚠️ ${e.message}`;
    }
    return "⚠️ parse failed";
  }
  // An unbound root identifier means the author named something that does not
  // exist — render the source so the mistake is visible in game rather than
  // silently erasing the text (ADR `expression-parity` §4). A *bound* root with a
  // missing field is normal (rows may omit fields) and falls through to "".
  for (const name of rootIdentifiers(ast)) {
    if (!opts.scope.has(name)) return `{${expr}}`;
  }
  try {
    const v = evaluate(ast, opts.scope);
    return toStringValue(v);
  } catch (e) {
    return `⚠️ ${(e as Error).message}`;
  }
}
