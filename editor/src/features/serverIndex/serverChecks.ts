import { commandsOf, dialogsOf, menusOf, parseDocKey } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { deriveServerGraph } from "@/features/canvas/serverGraph";
import { type ElsewhereWhere, isWrittenName, reachOf } from "@/lib/pack/elsewhere";
import { imageRefsIn, kitNameOf } from "@/lib/pack/kit";
import { namespaceOf } from "./serverIndex";

export interface IssueOwner {
  namespace: string;
  projectName: string;
  docId: string;
}

export type ServerIssue =
  /** Two commands claim the same name or alias: the game keeps only one. */
  | { kind: "command_conflict"; name: string; owners: IssueOwner[] }
  /** A menu or dialog has the same id in two projects: the game keeps only one. */
  | { kind: "duplicate_id"; docKind: "menu" | "dialog"; id: string; owners: IssueOwner[] }
  /** A link in the edited project leads nowhere safe. */
  | {
      kind: "broken_link";
      reason: "missing" | "ambiguous";
      targetId: string;
      from: { docId: string; docKind: "menu" | "command" | "dialog" };
    }
  /**
   * Menus of the edited project, or files of its kinds that ask the pack for images (`files`,
   * when some do), name an image no one on the server holds: it shows nothing.
   */
  | { kind: "image_missing"; ref: string; menus: string[]; files?: string[] }
  /**
   * Menus or such files of the edited project name by its name alone an image another module
   * holds (ADR `common-images-and-themes`, decision 3): `<module>:<name>` says whose it is.
   */
  | { kind: "image_elsewhere"; ref: string; module: string; menus: string[]; files?: string[] }
  /**
   * Layers of a composed image of the edited project name what no layer can take: a layer is
   * a PNG of the module or a common image, and is left out without one.
   */
  | { kind: "layer_missing"; image: string; refs: string[] };

/** What names images in the edited module beside its menus, as its draft holds it. */
export interface ImageWriters {
  /** The files of its kinds that ask the pack for images: their names are read as a menu's. */
  files: readonly { name: string; refs: readonly string[] }[];
  /** Its composed images, with the names their layers write. */
  composed: readonly { name: string; refs: readonly string[] }[];
  /** Whether the module holds a PNG of that name: what a layer takes when it names no common image. */
  png: (name: string) => boolean;
}

export interface ServerChecks {
  /**
   * `pending` / `unavailable`: the checks were **not** run — an absence of
   * problems must then never read as a green light. `none`: no index to wait
   * for (outside a server).
   */
  status: "ready" | "pending" | "unavailable" | "none";
  issues: ServerIssue[];
  /** Projects the index could not read: the checks are then incomplete. */
  unreadable: string[];
}

export function serverChecksFor(
  edited: Project,
  index: {
    status: "idle" | "loading" | "ready" | "unavailable";
    projects: Project[];
    failed: string[];
  },
  /**
   * Who holds which image on the server (`imageHolders`); absent: the images are not checked.
   * Nor are they when a module could not be read: its images may answer a name.
   */
  images?: ElsewhereWhere | null,
  /** What else names images in the edited module; absent: its menus alone are checked. */
  writers?: ImageWriters,
): ServerChecks {
  switch (index.status) {
    case "ready":
      return {
        status: "ready",
        issues: [
          ...checkServerIssues(edited, index.projects),
          ...(images && index.failed.length === 0 ? checkImageIssues(edited, images, writers) : []),
        ],
        unreadable: index.failed,
      };
    case "loading":
      return { status: "pending", issues: [], unreadable: [] };
    case "unavailable":
      return { status: "unavailable", issues: [], unreadable: [] };
    default:
      return { status: "none", issues: [], unreadable: [] };
  }
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byOwner = (a: IssueOwner, b: IssueOwner) =>
  byText(a.namespace, b.namespace) || byText(a.docId, b.docId);

/**
 * What a deployment of project `edited` could break **on the server**, seen
 * by no single-project check: the plugin stores menus, dialogs and commands in
 * global tables, with no notion of project.
 *
 * `edited` is its working state; `others` the published state of the other
 * projects. Only problems involving `edited` are reported — a conflict between
 * two other projects already exists, and this deployment does not cause it.
 * These are warnings: nothing here prevents deploying.
 */
export function checkServerIssues(edited: Project, others: Project[]): ServerIssue[] {
  const editedNamespace = namespaceOf(edited);
  const rest = others.filter((p) => namespaceOf(p) !== editedNamespace);
  const all = [edited, ...rest];
  return [
    ...commandConflicts(all, editedNamespace),
    ...duplicateIds(all, editedNamespace),
    ...brokenLinks(edited, all),
  ];
}

const owner = (project: Project, docId: string): IssueOwner => ({
  namespace: namespaceOf(project),
  projectName: project.name,
  docId,
});

/** The name under which the game registers a command: `name`, else its id. */
const triggerName = (c: { id: string; name: string }) => (c.name || c.id).toLowerCase();

function commandConflicts(all: Project[], editedNamespace: string): ServerIssue[] {
  const byTrigger = new Map<string, Map<string, IssueOwner>>();
  for (const project of all) {
    for (const command of commandsOf(project)) {
      const who = owner(project, command.id);
      const key = `${who.namespace}/${who.docId}`;
      const triggers = [
        triggerName(command),
        ...(command.aliases ?? []).map((a) => a.toLowerCase()),
      ];
      for (const trigger of triggers) {
        const owners = byTrigger.get(trigger) ?? new Map<string, IssueOwner>();
        owners.set(key, who);
        byTrigger.set(trigger, owners);
      }
    }
  }
  return [...byTrigger.entries()]
    .filter(
      ([, owners]) =>
        owners.size > 1 && [...owners.values()].some((o) => o.namespace === editedNamespace),
    )
    .sort(([a], [b]) => byText(a, b))
    .map(([name, owners]) => ({
      kind: "command_conflict" as const,
      name,
      owners: [...owners.values()].sort(byOwner),
    }));
}

function duplicateIds(all: Project[], editedNamespace: string): ServerIssue[] {
  const issues: ServerIssue[] = [];
  for (const docKind of ["menu", "dialog"] as const) {
    const byId = new Map<string, IssueOwner[]>();
    for (const project of all) {
      const docs = docKind === "menu" ? menusOf(project) : dialogsOf(project);
      for (const doc of docs)
        byId.set(doc.id, [...(byId.get(doc.id) ?? []), owner(project, doc.id)]);
    }
    for (const [id, owners] of byId) {
      if (owners.length > 1 && owners.some((o) => o.namespace === editedNamespace))
        issues.push({ kind: "duplicate_id", docKind, id, owners: owners.sort(byOwner) });
    }
  }
  return issues.sort((a, b) =>
    a.kind === "duplicate_id" && b.kind === "duplicate_id"
      ? byText(a.docKind, b.docKind) || byText(a.id, b.id)
      : 0,
  );
}

function brokenLinks(edited: Project, all: Project[]): ServerIssue[] {
  const prefix = `${edited.id}/`;
  return deriveServerGraph(all)
    .unresolved.filter((u) => u.source.startsWith(prefix))
    .map((u) => {
      const from = parseDocKey(u.source.slice(prefix.length))!;
      return {
        kind: "broken_link" as const,
        reason: u.reason,
        targetId: u.targetId,
        from: {
          docId: from.id,
          docKind: (from.kind === "menu" || from.kind === "command" ? from.kind : "dialog") as
            | "menu"
            | "command"
            | "dialog",
        },
      };
    })
    .sort((a, b) => byText(a.from.docId, b.from.docId) || byText(a.targetId, b.targetId));
}

/**
 * The images the menus of `edited` and the files of its kinds (`writers.files`) name that no
 * one holds (`image_missing`), and the ones a name alone finds in another module
 * (`image_elsewhere`), by the rule the pack reads a name with (`reachOf`). One issue per name,
 * with the menus and the files that write it. Then the layers of its composed images that
 * take nothing (`layer_missing`), one issue per composed image: a layer is read by another
 * rule (`renderComposed`), a common image by its whole name or a PNG of the module.
 */
export function checkImageIssues(
  edited: Project,
  where: ElsewhereWhere,
  writers?: ImageWriters,
): ServerIssue[] {
  type Writers = { menus: Set<string>; files: Set<string> };
  const none = (): Writers => ({ menus: new Set(), files: new Set() });
  const missing = new Map<string, Writers>();
  const elsewhere = new Map<string, Writers & { module: string }>();
  const read = (refs: Iterable<string>, into: "menus" | "files", writer: string) => {
    for (const ref of new Set(refs)) {
      if (!isWrittenName(ref)) continue;
      const reach = reachOf(ref, where);
      if (reach.kind === "none") {
        const held = missing.get(ref) ?? none();
        held[into].add(writer);
        missing.set(ref, held);
      } else if (reach.kind === "module" && !ref.includes(":")) {
        const held = elsewhere.get(ref) ?? { module: reach.folder, ...none() };
        held[into].add(writer);
        elsewhere.set(ref, held);
      }
    }
  };
  for (const menu of menusOf(edited)) read(imageRefsIn(menu), "menus", menu.id);
  for (const file of writers?.files ?? []) read(file.refs, "files", file.name);
  const written = (held: Writers) => ({
    menus: [...held.menus].sort(byText),
    ...(held.files.size > 0 ? { files: [...held.files].sort(byText) } : {}),
  });
  const layers: ServerIssue[] = [];
  for (const image of [...(writers?.composed ?? [])].sort((a, b) => byText(a.name, b.name))) {
    const refs = [...new Set(image.refs)].filter((ref) => {
      const common = kitNameOf(ref);
      return common === null ? !writers?.png(ref) : !where.base(common) && !where.common(common);
    });
    if (refs.length > 0) layers.push({ kind: "layer_missing", image: image.name, refs });
  }
  return [
    ...[...missing.entries()]
      .sort(([a], [b]) => byText(a, b))
      .map(([ref, held]) => ({ kind: "image_missing" as const, ref, ...written(held) })),
    ...[...elsewhere.entries()]
      .sort(([a], [b]) => byText(a, b))
      .map(([ref, held]) => ({
        kind: "image_elsewhere" as const,
        ref,
        module: held.module,
        ...written(held),
      })),
    ...layers,
  ];
}
