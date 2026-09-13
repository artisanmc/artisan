export interface DraftSnapshot {
  baseline: Record<string, string>;
  tree: Record<string, string>;
  initialTree?: Record<string, string>;
  at: number;
  renames?: { from: string; to: string }[];
  binaryBaseline?: Record<string, { hash: string; size: number }>;
  binaryTree?: Record<string, { hash: string; size: number }>;
}

/** Portable private data: project identity is supplied by its containing directory. */
export interface StoredDraft {
  schema: "artisan-draft/v1";
  id: string;
  ownerId: string;
  name: string;
  revision: number;
  status: string;
  snapshot: DraftSnapshot;
  updatedBy: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}
export interface DraftResult {
  ok: boolean;
  error?: string;
  draft?: StoredDraft;
  drafts?: StoredDraft[];
  wrote?: number;
  content_base64?: string;
  conflicts?: unknown[];
}
export type DraftOutcome = { kind: "result"; result: DraftResult } | { kind: "offline" } | { kind: "timeout" };
export type DraftBody = { name: string; snapshot: DraftSnapshot };

/** Every instance is bound to an authorized principal, never a body-supplied owner. */
export interface DraftStore {
  list(): Promise<DraftOutcome>;
  read(id: string): Promise<DraftOutcome>;
  create(id: string, operationId: string, body: DraftBody): Promise<DraftOutcome>;
  update(id: string, revision: number, operationId: string, body: DraftBody): Promise<DraftOutcome>;
  discard(id: string, revision: number, operationId: string): Promise<DraftOutcome>;
  publish(id: string, revision: number, operationId: string): Promise<DraftOutcome>;
  writeBlob(id: string, revision: number, operationId: string, hash: string, contentBase64: string): Promise<DraftOutcome>;
  readBlob(id: string, hash: string): Promise<DraftOutcome>;
}
