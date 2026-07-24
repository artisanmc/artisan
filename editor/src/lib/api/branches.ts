const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface Branch {
  projectId: string;
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
export interface Commit { id: string; projectId: string; parentId: string | null; contentHash: string; authorUserId: string | null; message: string; createdAt: string; }

export async function listBranches(networkId: string, projectId: string): Promise<Branch[]> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/projects/${projectId}/branches`, { credentials: "include" });
  if (!res.ok) throw new Error(`listBranches failed: ${res.status}`);
  return ((await res.json()) as { branches: Branch[] }).branches;
}

export async function createBranch(networkId: string, projectId: string, name: string, from: string): Promise<Branch> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/projects/${projectId}/branches`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, from }),
  });
  if (!res.ok) throw new Error(`createBranch failed: ${res.status}`);
  return ((await res.json()) as { branch: Branch }).branch;
}

export async function listCommits(networkId: string, projectId: string, branch: string, limit = 50): Promise<Commit[]> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/projects/${projectId}/commits?branch=${encodeURIComponent(branch)}&limit=${limit}`, { credentials: "include" });
  if (!res.ok) throw new Error(`listCommits failed: ${res.status}`);
  return ((await res.json()) as { commits: Commit[] }).commits;
}

/**
 * Fetches the file content of a branch's HEAD commit. Used by the
 * Revert / Discard action in user-auth mode to restore the last committed
 * (deployed) state, replacing the editor's WIP (parsed via projectFromFiles).
 */
export async function getBranchHead(
  networkId: string,
  projectId: string,
  branch: string,
): Promise<{ commit: { id: string; contentHash: string; message: string; createdAt: string }; files: Record<string, string> } | null> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/projects/${projectId}/branches/${encodeURIComponent(branch)}/head`,
    { credentials: "include" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getBranchHead failed: ${res.status}`);
  return res.json();
}

export async function createCommit(networkId: string, projectId: string, branch: string, message: string): Promise<Commit> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/projects/${projectId}/commits`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch, message }),
  });
  if (!res.ok) throw new Error(`createCommit failed: ${res.status}`);
  return ((await res.json()) as { commit: Commit }).commit;
}

export async function promoteBranch(networkId: string, projectId: string, src: string, dst: string): Promise<{ ok: boolean; advanced: boolean }> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/projects/${projectId}/branches/${src}/promote/${dst}`, {
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

/**
 * Fetches the file content of a specific commit by id. Used by the History
 * tab Restore action to roll back the editor's WIP to any past commit
 * (parsed via projectFromFiles).
 */
export async function getCommitContent(
  networkId: string,
  projectId: string,
  commitId: string,
): Promise<{ commit: { id: string; contentHash: string; message: string; createdAt: string }; files: Record<string, string> } | null> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/projects/${projectId}/commits/${commitId}/content`,
    { credentials: "include" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getCommitContent failed: ${res.status}`);
  return res.json();
}
