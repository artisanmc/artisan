const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface Branch {
  packId: string;
  name: string;
  headCommitId: string;
  /**
   * content_hash of the head commit. Used by the editor to detect a divergence
   * between the live WIP buffer (`pack.hash`) and the branch HEAD — i.e. is
   * there anything to commit. "" when the head commit row isn't readable
   * (shouldn't happen in practice).
   */
  headCommitHash: string;
  createdAt: string;
  updatedAt: string;
}
export interface Commit { id: string; packId: string; parentId: string | null; contentHash: string; authorUserId: string | null; message: string; createdAt: string; }

export async function listBranches(networkId: string, packId: string): Promise<Branch[]> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/packs/${packId}/branches`, { credentials: "include" });
  if (!res.ok) throw new Error(`listBranches failed: ${res.status}`);
  return ((await res.json()) as { branches: Branch[] }).branches;
}

export async function createBranch(networkId: string, packId: string, name: string, from: string): Promise<Branch> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/packs/${packId}/branches`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, from }),
  });
  if (!res.ok) throw new Error(`createBranch failed: ${res.status}`);
  return ((await res.json()) as { branch: Branch }).branch;
}

export async function listCommits(networkId: string, packId: string, branch: string, limit = 50): Promise<Commit[]> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/packs/${packId}/commits?branch=${encodeURIComponent(branch)}&limit=${limit}`, { credentials: "include" });
  if (!res.ok) throw new Error(`listCommits failed: ${res.status}`);
  return ((await res.json()) as { commits: Commit[] }).commits;
}

/**
 * Fetches the editor + files content of a branch's HEAD commit. Used by the
 * Revert / Discard action in user-auth mode to restore the last committed
 * (deployed) state, replacing the editor's WIP.
 */
export async function getBranchHead(
  networkId: string,
  packId: string,
  branch: string,
): Promise<{ commit: { id: string; contentHash: string; message: string; createdAt: string }; editor: Record<string, unknown>; files: Record<string, string> } | null> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/packs/${packId}/branches/${encodeURIComponent(branch)}/head`,
    { credentials: "include" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getBranchHead failed: ${res.status}`);
  return res.json();
}

export async function createCommit(networkId: string, packId: string, branch: string, message: string): Promise<Commit> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/packs/${packId}/commits`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch, message }),
  });
  if (!res.ok) throw new Error(`createCommit failed: ${res.status}`);
  return ((await res.json()) as { commit: Commit }).commit;
}

export async function promoteBranch(networkId: string, packId: string, src: string, dst: string): Promise<{ ok: boolean; advanced: boolean }> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/packs/${packId}/branches/${src}/promote/${dst}`, {
    method: "POST",
    credentials: "include",
  });
  if (res.status === 409) {
    const body = await res.json();
    throw new Error(body.error ?? "not_fast_forward");
  }
  if (!res.ok) throw new Error(`promoteBranch failed: ${res.status}`);
  return res.json();
}

export type ConflictResolutionKind = "modify-modify" | "delete-modify";

export interface Conflict {
  conflictKey: string;
  collection: string;
  resolution: ConflictResolutionKind;
  srcValue: unknown | null;
  dstValue: unknown | null;
  baseValue: unknown | null;
}

export type MergePlan =
  | { kind: "already_merged"; advanced: false }
  | { kind: "fast_forward"; advanced: true; head_commit_id: string }
  | {
      kind: "auto" | "conflicts";
      conflicts: Conflict[];
      mergedEditorJson: unknown;
      lcaCommitId: string;
      srcCommitId: string;
      dstCommitId: string;
    };

export async function mergeBranches(
  networkId: string,
  packId: string,
  src: string,
  dst: string,
  message?: string,
): Promise<MergePlan> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/packs/${packId}/branches/${src}/merge-into/${dst}`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message !== undefined ? { message } : {}),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `mergeBranches failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetches the editor + files content of a specific commit by id. Used by the
 * History tab Restore action to roll back the editor's WIP to any past commit.
 */
export async function getCommitContent(
  networkId: string,
  packId: string,
  commitId: string,
): Promise<{ commit: { id: string; contentHash: string; message: string; createdAt: string }; editor: Record<string, unknown>; files: Record<string, string> } | null> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/packs/${packId}/commits/${commitId}/content`,
    { credentials: "include" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getCommitContent failed: ${res.status}`);
  return res.json();
}

export async function resolveMerge(
  networkId: string,
  packId: string,
  src: string,
  dst: string,
  args: {
    resolutions: Record<string, "src" | "dst">;
    lcaCommitId: string;
    srcCommitId: string;
    dstCommitId: string;
    mergedFilesJson: Record<string, string>;
    mergedEditorJson: unknown;
    message?: string;
  },
): Promise<{ commit: Commit; head_commit_id: string }> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/packs/${packId}/branches/${src}/merge-into/${dst}/resolve`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    },
  );
  if (res.status === 409) {
    const body = await res.json();
    throw new Error(body.error ?? "stale_merge");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `resolveMerge failed: ${res.status}`);
  }
  return res.json();
}
