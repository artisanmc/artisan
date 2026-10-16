import { documentIds } from "@/domain/documents";
import type { CanvasGroup, Project } from "./types";

/** Every Document id in a project — the live set groups may reference. */
export const liveDocumentIds = (project: Project): string[] => documentIds(project);

export const DEFAULT_GROUP_COLOR = "#60a5fa";
export const isGroupColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/**
 * Tolerant metadata reader: each live Document belongs to at most one group.
 * Reads `nodeIds` (menus, commands and dialogs) and the legacy `menuIds` field
 * written before groups were generalized.
 */
export function normalizeCanvasGroups(value: unknown, liveIds: Iterable<string>): CanvasGroup[] {
  if (!Array.isArray(value)) return [];
  const live = new Set(liveIds);
  const assigned = new Set<string>();
  const ids = new Set<string>();
  const groups: CanvasGroup[] = [];
  for (const raw of value) {
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof raw.id !== "string" ||
      !raw.id ||
      ids.has(raw.id) ||
      typeof raw.name !== "string" ||
      !raw.name.trim()
    )
      continue;
    const rawMembers = Array.isArray(raw.nodeIds)
      ? raw.nodeIds
      : Array.isArray(raw.menuIds)
        ? raw.menuIds
        : null;
    if (!rawMembers) continue;
    const members = [
      ...new Set<string>(
        rawMembers.filter(
          (id: unknown): id is string =>
            typeof id === "string" && live.has(id) && !assigned.has(id),
        ),
      ),
    ];
    if (!members.length) continue;
    ids.add(raw.id);
    for (const id of members) assigned.add(id);
    const p = raw.position;
    groups.push({
      id: raw.id,
      name: raw.name.trim(),
      nodeIds: members,
      ...(isGroupColor(raw.color) ? { color: raw.color } : {}),
      ...(p && Number.isFinite(p.x) && Number.isFinite(p.y)
        ? { position: { x: p.x, y: p.y } }
        : {}),
    });
  }
  return groups;
}
