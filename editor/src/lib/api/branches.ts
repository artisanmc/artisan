const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface Branch { packId: string; name: string; headCommitId: string; createdAt: string; updatedAt: string; }
export interface Commit { id: string; packId: string; parentId: string | null; contentHash: string; authorUserId: string | null; message: string; createdAt: string; }

export async function listBranches(networkId: string, packId: string): Promise<Branch[]> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/packs/${packId}/branches`, { credentials: "include" });
  if (!res.ok) throw new Error(`listBranches failed: ${res.status}`);
  return ((await res.json()) as { branches: Branch[] }).branches;
}

export async function createBranch(networkId: string, packId: string, name: string, from: string): Promise<Branch> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/packs/${packId}/branches`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, from }),
  });
  if (!res.ok) throw new Error(`createBranch failed: ${res.status}`);
  return ((await res.json()) as { branch: Branch }).branch;
}

export async function listCommits(networkId: string, packId: string, branch: string, limit = 50): Promise<Commit[]> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/packs/${packId}/commits?branch=${encodeURIComponent(branch)}&limit=${limit}`, { credentials: "include" });
  if (!res.ok) throw new Error(`listCommits failed: ${res.status}`);
  return ((await res.json()) as { commits: Commit[] }).commits;
}

export async function createCommit(networkId: string, packId: string, branch: string, message: string): Promise<Commit> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/packs/${packId}/commits`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch, message }),
  });
  if (!res.ok) throw new Error(`createCommit failed: ${res.status}`);
  return ((await res.json()) as { commit: Commit }).commit;
}

export async function promoteBranch(networkId: string, packId: string, src: string, dst: string): Promise<{ ok: boolean; advanced: boolean }> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/packs/${packId}/branches/${src}/promote/${dst}`, {
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
