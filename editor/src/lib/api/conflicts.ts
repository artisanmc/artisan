import type { ConflictSummary } from "@/state/conflictsStore";

export interface ConflictDetail extends ConflictSummary {
  diskFiles: Record<string, string>;
}

export async function listConflicts(apiUrl: string, token: string): Promise<ConflictSummary[]> {
  const res = await fetch(`${apiUrl}/api/editor-session/${token}/conflicts`);
  if (!res.ok) throw new Error(`list_failed_${res.status}`);
  const body = (await res.json()) as { conflicts: ConflictSummary[] };
  return body.conflicts;
}

export async function getConflict(apiUrl: string, token: string, id: string): Promise<ConflictDetail> {
  const res = await fetch(`${apiUrl}/api/editor-session/${token}/conflicts/${id}`);
  if (!res.ok) throw new Error(`get_failed_${res.status}`);
  const body = (await res.json()) as { conflict: ConflictDetail };
  return body.conflict;
}

export async function resolveConflict(
  apiUrl: string,
  token: string,
  id: string,
  choice: "editor" | "server",
): Promise<void> {
  const res = await fetch(`${apiUrl}/api/editor-session/${token}/conflicts/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ choice }),
  });
  if (res.status === 409) throw new Error("already_resolved");
  if (!res.ok) throw new Error(`resolve_failed_${res.status}`);
}
