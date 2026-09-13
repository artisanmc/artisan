import { applyRenames, planWrite } from "../../../editor/src/features/project/diskSave";
import type { projectDrafts } from "../db/schema";
import { ServerProjectStorage } from "./storage/ServerProjectStorage";
import type { ProjectStorage } from "./storage/ProjectStorage";

export type DraftSnapshot = typeof projectDrafts.$inferSelect.snapshot;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function path(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\\:]/.test(value) &&
    Array.from(value).every((char) => char.charCodeAt(0) >= 32) &&
    value
      .split("/")
      .every(
        (part) =>
          part !== "" &&
          part !== "." &&
          part !== ".." &&
          !["__proto__", "constructor", "prototype"].includes(part),
      ) &&
    (!value.startsWith(".") || value === ".artisan/editor.yaml")
  );
}
function tree(value: unknown): value is Record<string, string> {
  return (
    record(value) &&
    Object.keys(value).length <= 5000 &&
    Object.entries(value).every(([key, content]) => path(key) && typeof content === "string")
  );
}
export function validSnapshot(value: unknown): value is DraftSnapshot {
  if (
    !record(value) ||
    !tree(value.baseline) ||
    !tree(value.tree) ||
    (value.initialTree !== undefined && !tree(value.initialTree)) ||
    typeof value.at !== "number" ||
    !Number.isFinite(value.at) ||
    value.at < 0
  )
    return false;
  for (const name of ["binaryBaseline", "binaryTree"] as const) {
    const entries = value[name];
    if (entries === undefined) continue;
    if (!record(entries) || Object.keys(entries).length > 5000 || !Object.entries(entries).every(([key, ref]) => path(key) && record(ref) && typeof ref.hash === "string" && /^[a-f0-9]{64}$/.test(ref.hash) && Number.isSafeInteger(ref.size) && (ref.size as number) >= 0)) return false;
  }
  if (value.renames === undefined) return true;
  if (!Array.isArray(value.renames) || value.renames.length > 5000) return false;
  const from = new Set<string>();
  const to = new Set<string>();
  return value.renames.every((r) => {
    if (
      !record(r) ||
      !path(r.from) ||
      !path(r.to) ||
      r.from === r.to ||
      from.has(r.from) ||
      to.has(r.to)
    )
      return false;
    from.add(r.from);
    to.add(r.to);
    return true;
  });
}
export function validDraftBody(body: unknown): body is { name: string; snapshot: DraftSnapshot } {
  return (
    record(body) &&
    typeof body.name === "string" &&
    body.name.trim().length > 0 &&
    body.name.length <= 120 &&
    validSnapshot(body.snapshot)
  );
}

/** Shared publication operation for HTTP and future delegated transports. */
export async function publishDraftSnapshot(
  serverKeyId: string,
  diskId: string,
  snapshot: DraftSnapshot,
) {
  return publishStoredDraft(new ServerProjectStorage({ kind: "server", serverKeyId, folderName: diskId }), snapshot);
}

export async function publishStoredDraft(storage: ProjectStorage, snapshot: DraftSnapshot) {
  const plan = await applyRenames(
    await planWrite(snapshot.baseline, snapshot.tree),
    snapshot.renames ?? [],
    snapshot.baseline,
  );
  if (plan.empty) return { kind: "result" as const, result: { ok: true as const }, wrote: 0 };
  const result = await storage.write({
    ...plan,
    create: false,
  });
  return { ...result, wrote: plan.files.length + plan.deletes.length + plan.renames.length };
}
