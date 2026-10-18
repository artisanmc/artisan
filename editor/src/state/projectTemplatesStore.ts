import type { ProjectTarget } from "@/lib/api/projectFiles";
import { type FileOrigin, fetchProjectOrigins } from "@/lib/api/templates";
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
  /** (Re)reads the origins of `projectId` and hashes `files`, its published base. */
  load: (projectId: string, target: ProjectTarget, files: Record<string, string>) => Promise<void>;
}

const EMPTY: ProjectTemplatesEntry = { status: "loading", origins: {}, hashes: {} };

export const useProjectTemplatesStore = create<ProjectTemplatesState>((set, get) => ({
  entries: {},
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
}));
