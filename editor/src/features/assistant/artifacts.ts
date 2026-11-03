import { normalizeDataSources } from "@/domain/dataModels";
import { adoptProjectActionTexts } from "@/domain/i18nSites";
import type { Project, ProjectId } from "@/domain/types";
import type { AiEvent } from "@/lib/api/ai";
import { yamlStem } from "@/lib/yamlFiles";
import { adoptLateDocuments, projectFromFiles } from "@/schema/projectFromFiles";
import { listModules } from "@artisan/editor-sdk";

/** A file the assistant wrote in a conversation: one card of the Assistant tab. */
export interface Artifact {
  /** Project, draft and path: the same file written again is the same card. */
  key: string;
  /** The Project's id, `<server id>.<folder>`. */
  project: string;
  draftId: string;
  draftName: string | null;
  /** Relative to the Project's folder, as the draft's tree keys it. */
  path: string;
  /** The event of its last write: the card reads the draft again when it moves. */
  seq: number;
}

/** The files a conversation wrote, the last written first. A refused write leaves no card. */
export function artifactsOf(events: readonly AiEvent[]): Artifact[] {
  const names = new Map<string, string>();
  const byKey = new Map<string, Artifact>();
  for (const event of events) {
    if (event.type !== "tool" || !event.draft) continue;
    if (event.draft.name) names.set(event.draft.id, event.draft.name);
    if (event.name !== "write_document" || !event.ok || !event.path) continue;
    const key = `${event.draft.project}\u0000${event.draft.id}\u0000${event.path}`;
    byKey.delete(key);
    byKey.set(key, {
      key,
      project: event.draft.project,
      draftId: event.draft.id,
      draftName: null,
      path: event.path,
      seq: event.seq,
    });
  }
  return [...byKey.values()]
    .reverse()
    .map((a) => ({ ...a, draftName: names.get(a.draftId) ?? null }));
}

/** The drafts a conversation started or wrote into: Deploy's review opens with them picked. */
export function conversationDrafts(events: readonly AiEvent[]): string[] {
  const ids = new Set<string>();
  for (const event of events)
    if (event.type === "tool" && event.ok && event.draft) ids.add(event.draft.id);
  return [...ids];
}

/** The last event that wrote into each draft, by draft id. */
export function draftVersions(events: readonly AiEvent[]): Map<string, number> {
  const versions = new Map<string, number>();
  for (const event of events)
    if (event.type === "tool" && event.ok && event.draft) versions.set(event.draft.id, event.seq);
  return versions;
}

/** The menu a file is, by the layout's rule (`<folders…>/menus/<id>.yml`), or null. */
export function menuIdOfPath(path: string): string | null {
  const segs = path.split("/");
  if (segs.length < 2 || segs[segs.length - 2] !== "menus") return null;
  return yamlStem(segs[segs.length - 1]!);
}

/** Whether a loaded Project is the one an assistant event names (`<server id>.<folder>`). */
export function isProject(project: Project, ref: string): boolean {
  return project.id === ref || `${project.serverKeyId}.${project.diskId ?? project.id}` === ref;
}

/**
 * [base] as a draft's [tree] has it: the files parsed as a Project opens them, without the
 * server's declared models and actions (a preview of what the draft holds, not an editor).
 */
export function projectFromDraftTree(base: Project, tree: Record<string, string>): Project {
  const folder = base.diskId ?? base.id;
  const files: Record<string, string> = {};
  for (const [rel, content] of Object.entries(tree))
    files[`plugins/Artisan/projects/${folder}/${rel}`] = content;
  const project = projectFromFiles(base.id as ProjectId, files, {
    name: base.name,
    diskId: base.diskId,
    serverKeyId: base.serverKeyId,
  });
  adoptProjectActionTexts(project);
  normalizeDataSources(project);
  for (const module of listModules()) module.migrateProject?.(project);
  adoptLateDocuments(project);
  return project;
}
