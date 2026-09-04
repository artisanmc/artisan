const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface ImportSourceFile {
  path: string;
  size: number;
}

export interface ImportSource {
  id: string;
  label: string;
  files: ImportSourceFile[];
  error?: "too_many_entries";
}

export type ImportSourcesResult =
  | { ok: true; sources: ImportSource[] }
  | {
      ok: false;
      error: "server_offline" | "fetch_timeout" | "read_error" | "network_error";
    };

export class ImportSourcesApiError extends Error {
  readonly code = "read_error" as const;
  readonly status = 502 as const;

  constructor() {
    super("read_error");
    this.name = "ImportSourcesApiError";
  }
}

function validateSourcesBody(raw: unknown): ImportSource[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rawSources = (raw as Record<string, unknown>).sources;
  if (!Array.isArray(rawSources)) return null;

  const sources: ImportSource[] = [];
  for (const candidate of rawSources) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const source = candidate as Record<string, unknown>;
    if (
      typeof source.id !== "string" ||
      typeof source.label !== "string" ||
      !Array.isArray(source.files)
    ) {
      return null;
    }

    const files: ImportSourceFile[] = [];
    for (const candidateFile of source.files) {
      if (!candidateFile || typeof candidateFile !== "object" || Array.isArray(candidateFile)) {
        return null;
      }
      const file = candidateFile as Record<string, unknown>;
      if (
        typeof file.path !== "string" ||
        typeof file.size !== "number" ||
        !Number.isFinite(file.size) ||
        file.size < 0
      ) {
        return null;
      }
      files.push({ path: file.path, size: file.size });
    }

    if ("error" in source) {
      if (source.error !== "too_many_entries") return null;
      sources.push({ id: source.id, label: source.label, files, error: source.error });
    } else {
      sources.push({ id: source.id, label: source.label, files });
    }
  }
  return sources;
}

export async function listImportSources(
  networkId: string,
  serverId: string,
  projectId: string,
): Promise<ImportSourcesResult> {
  let res: Response;
  try {
    const segments = [networkId, serverId, projectId].map(encodeURIComponent);
    res = await fetch(
      `${API_URL}/api/v1/networks/${segments[0]}/servers/${segments[1]}/projects/${segments[2]}/import-sources`,
      { credentials: "include" },
    );
  } catch {
    return { ok: false, error: "network_error" };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    if (res.ok) throw new ImportSourcesApiError();
    body = null;
  }

  if (res.ok) {
    const sources = validateSourcesBody(body);
    if (!sources) throw new ImportSourcesApiError();
    return { ok: true, sources };
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const error = (body as Record<string, unknown>).error;
    if (error === "server_offline") {
      return { ok: false, error: "server_offline" };
    }
    if (error === "fetch_timeout") {
      return { ok: false, error: "fetch_timeout" };
    }
  }
  return { ok: false, error: "read_error" };
}
