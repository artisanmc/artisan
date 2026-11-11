/**
 * Stored projects written before `Project.documents` carry the three parallel
 * fields `menus` / `commands` / `dialogs` (ADR `extensible-document-kinds`,
 * decision 10). Applied once, in place, wherever a Project is rehydrated from
 * JSON (an imported project file, a persisted draft). Idempotent.
 */
export function migrateProjectDocuments(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const p = raw as Record<string, unknown>;
  const documents = (p.documents && typeof p.documents === "object" ? p.documents : {}) as Record<
    string,
    unknown[]
  >;
  const legacy: [string, string][] = [
    ["menus", "menu"],
    ["commands", "command"],
    ["dialogs", "dialog"],
  ];
  for (const [field, kind] of legacy) {
    const docs = p[field];
    if (Array.isArray(docs)) {
      documents[kind] = [...(documents[kind] ?? []), ...docs];
    }
    delete p[field];
  }
  for (const [, kind] of legacy) documents[kind] ??= [];
  p.documents = documents;
}
