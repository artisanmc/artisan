import { toStringValue } from "./coercion";
import { evaluate } from "./evaluator";
import { parse } from "./parser";
import type { Scope } from "./scope";
import { templateSpans } from "./template/tokenizer";

/**
 * A template with its `{…}` evaluated against an example scope, for a preview. A
 * `{…}` that gives nothing it knows (unknown variable, bad syntax) stays as written,
 * so the reader sees what is missing.
 */
export function renderSample(src: string, sampleOf: (raw: string) => string | null): string {
  let out = "";
  let at = 0;
  for (const span of templateSpans(src)) {
    out += src.slice(at, span.from);
    const raw = src.slice(span.from, span.to);
    out += span.kind === "expression" ? (sampleOf(raw) ?? raw) : raw;
    at = span.to;
  }
  return out + src.slice(at);
}

/** What `{…}` (braces included) gives against `scope`, or null when it gives nothing known. */
export function sampleValue(raw: string, scope: Scope): string | null {
  try {
    const v = evaluate(parse(raw.slice(1, -1)), scope);
    return v === undefined || v === null ? null : toStringValue(v);
  } catch {
    return null;
  }
}

/** `m.can_promote` → "Can promote": a variable's name as words, until fields carry labels. */
export function humanizePath(path: string): string {
  const last =
    path
      .replace(/\[[^\]]*\]/g, "")
      .split(".")
      .pop() ?? path;
  const words = last.replace(/_/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : path;
}
