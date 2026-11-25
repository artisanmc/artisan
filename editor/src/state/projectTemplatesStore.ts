import type { ProjectTarget } from "@/lib/api/projectFiles";
import {
  type FileOrigin,
  type TemplateError,
  fetchProjectOrigins,
  fetchTemplateFiles,
  keepProjectOrigin,
} from "@/lib/api/templates";
import { hashContent } from "@/lib/contentHash";
import { create } from "zustand";

/**
 * What an open Project knows of the module templates it copied (ADR `module-templates`):
 * the origins the server recorded, and the hash of each published file (the base read
 * from disk), from which `templateStates` derives each file's state.
 */
export interface ProjectTemplatesEntry {
  /** `unsupported`: the server speaks an older protocol, it has no templates. */
  status: "loading" | "ready" | "unsupported" | "error";
  origins: Record<string, FileOrigin>;
  /** rel path → SHA-256 of the published content. */
  hashes: Record<string, string>;
}

interface ProjectTemplatesState {
  entries: Record<string, ProjectTemplatesEntry>;
  /** A template's files as its module ships them, by `server/module/template`, then path. */
  shipped: Record<string, Record<string, string>>;
  /** Reads a template's shipped files once per server; later calls reuse them. */
  loadShipped: (serverId: string, moduleId: string, templateId: string) => Promise<void>;
  /** (Re)reads the origins of `projectId` and hashes `files`, its published base. */
  load: (projectId: string, target: ProjectTarget, files: Record<string, string>) => Promise<void>;
  /**
   * The owner keeps their version of `path` although its original changed: asked of the
   * server, then recorded here as the server records it. The error, null when kept.
   */
  keep: (projectId: string, target: ProjectTarget, path: string) => Promise<TemplateError | null>;
}

/** Where the original of the file at `path` is kept in its module's folder. */
const ORIGINALS = "originals/";

/**
 * Whether the original of `path` changed since the owner's version of it (ADR
 * `common-images-and-themes`, decision 8): the server records, beside the owner's file, the
 * original it was made against, and beside the original the one it ships now.
 */
export function originalChanged(origins: Record<string, FileOrigin>, path: string): boolean {
  const mine = origins[path];
  const shipped = origins[`${ORIGINALS}${path}`];
  return !!mine && !!shipped && mine.hash !== shipped.hash;
}

export const shippedKey = (serverId: string, moduleId: string, templateId: string) =>
  `${serverId}/${moduleId}/${templateId}`;
const pendingShipped = new Set<string>();

const EMPTY: ProjectTemplatesEntry = { status: "loading", origins: {}, hashes: {} };

export const useProjectTemplatesStore = create<ProjectTemplatesState>((set, get) => ({
  entries: {},
  shipped: {},
  async loadShipped(serverId, moduleId, templateId) {
    const key = shippedKey(serverId, moduleId, templateId);
    if (get().shipped[key] || pendingShipped.has(key)) return;
    pendingShipped.add(key);
    try {
      const read = await fetchTemplateFiles(serverId, moduleId, templateId);
      if (read.ok) set((s) => ({ shipped: { ...s.shipped, [key]: read.files } }));
    } finally {
      pendingShipped.delete(key);
    }
  },
  async load(projectId, target, files) {
    const previous = get().entries[projectId] ?? EMPTY;
    set((s) => ({ entries: { ...s.entries, [projectId]: { ...previous, status: "loading" } } }));
    const [read, hashes] = await Promise.all([
      fetchProjectOrigins(target),
      Promise.all(
        Object.entries(files).map(
          async ([path, content]) => [path, await hashContent(content)] as const,
        ),
      ),
    ]);
    const entry: ProjectTemplatesEntry = read.ok
      ? { status: "ready", origins: read.origins, hashes: Object.fromEntries(hashes) }
      : {
          status: read.error === "plugin_update_required" ? "unsupported" : "error",
          origins: {},
          hashes: Object.fromEntries(hashes),
        };
    set((s) => ({ entries: { ...s.entries, [projectId]: entry } }));
  },
  async keep(projectId, target, path) {
    const kept = await keepProjectOrigin(target, path);
    if (!kept.ok) return kept.error;
    set((s) => {
      const entry = s.entries[projectId];
      const shipped = entry?.origins[`${ORIGINALS}${path}`];
      if (!entry || !shipped) return s;
      return {
        entries: {
          ...s.entries,
          [projectId]: { ...entry, origins: { ...entry.origins, [path]: shipped } },
        },
      };
    });
    return null;
  },
}));
