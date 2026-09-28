export type ResourceOrigin = "personal" | "module";
export type ResourceKind = "menu" | "dialog" | "command";

export interface ResourceEntry {
  projectId: string;
  path: string;
  origin: ResourceOrigin;
}

const roots: Record<string, ResourceKind> = {
  menus: "menu",
  dialogs: "dialog",
  commands: "command",
};

export function resourceKind(path: string): ResourceKind | null {
  const segments = path.replaceAll("\\", "/").split("/");
  if (segments.length < 2 || segments.length > 3) return null;
  const kind = roots[segments[0] ?? ""];
  if (!kind || segments.slice(1, -1).some((part) => !part || part.startsWith("."))) return null;
  const name = segments.at(-1) ?? "";
  return name && !name.startsWith(".") && /\.(yaml|yml)$/i.test(name) ? kind : null;
}

export function countPersonalResources(inventory: readonly ResourceEntry[]): number {
  return new Set(inventory.filter((entry) => entry.origin === "personal" && resourceKind(entry.path)).map((entry) => `${entry.projectId}\0${entry.path}`)).size;
}

export type QuotaReason = "free_quota_reached" | "free_quota_exceeded";

export function assessResourceMutation(input: {
  quota: number | null;
  inventory: readonly ResourceEntry[];
  projectId: string;
  origin: ResourceOrigin;
  files?: readonly string[];
  deletes?: readonly string[];
  renames?: readonly { from: string; to: string }[];
}): { allowed: boolean; count: number; reason: QuotaReason | null } {
  const existing = new Set(input.inventory.filter((entry) => entry.origin === "personal" && resourceKind(entry.path)).map((entry) => `${entry.projectId}\0${entry.path}`));
  const before = existing.size;
  if (input.origin === "module") return { allowed: true, count: before, reason: null };
  const key = (path: string) => `${input.projectId}\0${path}`;
  const changed = (input.files?.length ?? 0) > 0 || (input.renames?.length ?? 0) > 0;
  const removesRoot = (input.deletes ?? []).some((path) => resourceKind(path) && existing.has(key(path)));
  for (const path of input.deletes ?? []) if (resourceKind(path)) existing.delete(key(path));
  for (const rename of input.renames ?? []) {
    if (resourceKind(rename.from)) existing.delete(key(rename.from));
    if (resourceKind(rename.to)) existing.add(key(rename.to));
  }
  for (const path of input.files ?? []) if (resourceKind(path)) existing.add(key(path));
  const count = existing.size;
  const quota = input.quota;
  if (quota === null) return { allowed: true, count, reason: null };
  if (before > quota && (changed || (input.deletes?.length ?? 0) > 0 && !removesRoot)) return { allowed: false, count: before, reason: "free_quota_exceeded" };
  if (count > quota) return { allowed: false, count: before, reason: "free_quota_reached" };
  return { allowed: true, count, reason: null };
}
