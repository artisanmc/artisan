// YAML view of the Translations panel: the same tree shape as `lang/<code>.yaml`
// on disk (`nestLangTree`), annotated with per-entry comments a translator
// actually needs. Read by `TranslationPanel`'s YAML mode; Apply parses back
// through `flattenLangTree`, so a comment is never load-bearing.
import type { TranslationRow } from "@/lib/i18nUsages";
import { nestLangTree } from "@/lib/langTree";
import { Document as YamlDocument, isScalar } from "yaml";

/**
 * Grouping note: the tree groups related strings by structure (a menu's title
 * sits with its elements' titles and lores), which is what the row list's
 * sort-by-context was approximating. Row order therefore no longer shows in the
 * output — only the annotations follow the rows.
 */
export function serializeRows(
  rows: ReadonlyArray<TranslationRow>,
  defaultLang: string,
  activeLang: string,
  includeContext: boolean,
  texts: { header: string; subtitle: string },
): string {
  const flat: Record<string, string> = {};
  for (const row of rows) flat[row.key] = row.target;

  const doc = new YamlDocument(nestLangTree(flat));
  doc.commentBefore = [texts.header, texts.subtitle].map((line) => ` ${line}`).join("\n");

  const sameLang = defaultLang === activeLang;
  for (const row of rows) {
    const comments: string[] = [];
    // The context earns a line only when it says something the key doesn't —
    // a prettified item-set path, or "(unused)". Since ltext keys became
    // canonical addresses, the context is otherwise the key verbatim, and
    // repeating it above every entry is pure noise.
    if (includeContext && row.context !== row.key) comments.push(row.context);
    if (!sameLang && row.source)
      comments.push(`${defaultLang}: ${row.source.replace(/\n/g, "\\n")}`);
    if (comments.length === 0) continue;

    // Nested path, or the flat root key `nestLangTree` falls back to when a
    // leaf blocks the path (`a.b` alongside `a.b.c`).
    const node = doc.getIn(row.key.split("."), true) ?? doc.getIn([row.key], true);
    if (isScalar(node)) node.commentBefore = comments.map((c) => ` ${c}`).join("\n");
  }
  return doc.toString({ lineWidth: 0 });
}

/** List values can't become a translation — counted so Apply can report them. */
export function countListLeaves(node: unknown): number {
  if (Array.isArray(node)) return 1;
  if (node === null || typeof node !== "object") return 0;
  return Object.values(node as Record<string, unknown>).reduce<number>(
    (n, child) => n + countListLeaves(child),
    0,
  );
}
