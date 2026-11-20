import { apiFetch } from "./client";

/**
 * A server's imports of another plugin's data (ADR `data-imports`), behind
 * `artisan.editor.config`. A run happens on the server; starting one answers with its batch
 * before it ends, and its report is read back from the list.
 */
export interface ImportSource {
  /** `<module>:<source>`, such as `auctions:zauctionhouse`. */
  id: string;
  label: string;
  module: string;
  /** The source reads a file of `plugins/Artisan/imports/`. */
  readsFile: boolean;
  /** The plugin that must be removed before writing, when it runs right now. */
  conflictRunning: string | null;
}

export interface ImportCount {
  kind: string;
  label: string;
  count: number;
}

export interface ImportRejection {
  sourceId: string;
  code: string;
  message: string;
}

export interface ImportReport {
  /** The run threw: nothing else is known of it. */
  failed: string | null;
  /** Nothing was written: a dry run, or a run a blocker stopped. */
  dryRun: boolean;
  counts: ImportCount[];
  alreadyImported: number;
  rejected: ImportRejection[];
  blockers: string[];
  notes: string[];
}

export type ImportAction = "plan" | "apply" | "rollback";

export interface ImportRun {
  batch: string;
  source: string;
  module: string;
  action: ImportAction;
  /** The run wrote something (for an `apply` that failed: it may have). */
  applied: boolean;
  actor: string;
  /** Epoch milliseconds. */
  at: number;
  /** For a rollback, the batch it undid. */
  target: string | null;
  report: ImportReport | null;
}

export interface ActiveImport {
  batch: string;
  source: string;
  module: string;
  action: ImportAction;
  startedAt: number;
  target: string | null;
}

export interface ImportListing {
  sources: ImportSource[];
  files: string[];
  active: ActiveImport[];
  /** The last runs, newest first. */
  runs: ImportRun[];
}

const base = (serverId: string) => `/api/v1/servers/${encodeURIComponent(serverId)}/imports`;

export async function listImports(serverId: string): Promise<ImportListing> {
  const listing = await apiFetch<Partial<ImportListing>>(base(serverId));
  return {
    sources: listing.sources ?? [],
    files: listing.files ?? [],
    active: listing.active ?? [],
    runs: listing.runs ?? [],
  };
}

/** Starts a dry run of `source`, or the write with `confirm`; answers the run's batch. */
export async function startImport(
  serverId: string,
  source: string,
  options: { file?: string; confirm: boolean; lang: string },
): Promise<string> {
  const { batch } = await apiFetch<{ batch: string }>(`${base(serverId)}/run`, {
    method: "POST",
    json: { source, file: options.file, confirm: options.confirm, lang: options.lang },
  });
  return batch;
}

/** Starts a dry run of the rollback of `batch`, or the rollback with `confirm`; answers the run's batch. */
export async function startImportRollback(
  serverId: string,
  batch: string,
  options: { confirm: boolean; lang: string },
): Promise<string> {
  const reply = await apiFetch<{ batch: string }>(`${base(serverId)}/rollback`, {
    method: "POST",
    json: { batch, confirm: options.confirm, lang: options.lang },
  });
  return reply.batch;
}
