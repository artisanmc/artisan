import { commandsOf, dialogsOf, menusOf, parseDocKey } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { deriveServerGraph } from "@/features/canvas/serverGraph";
import { type ElsewhereWhere, isWrittenName, reachOf } from "@/lib/pack/elsewhere";
import { imageRefsIn } from "@/lib/pack/kit";
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
  /** Menus of the edited project name an image no one on the server holds: it shows nothing. */
  | { kind: "image_missing"; ref: string; menus: string[] }
  /**
   * Menus of the edited project name by its name alone an image another module holds (ADR
   * `common-images-and-themes`, decision 3): `<module>:<name>` says whose it is.
   */
  | { kind: "image_elsewhere"; ref: string; module: string; menus: string[] };

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
): ServerChecks {
  switch (index.status) {
    case "ready":
      return {
        status: "ready",
        issues: [
          ...checkServerIssues(edited, index.projects),
          ...(images && index.failed.length === 0 ? checkImageIssues(edited, images) : []),
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
 * The images the menus of `edited` name that no one holds (`image_missing`), and the ones a
 * name alone finds in another module (`image_elsewhere`), by the rule the pack reads a name
 * with (`reachOf`). One issue per name, with the menus that write it.
 */
export function checkImageIssues(edited: Project, where: ElsewhereWhere): ServerIssue[] {
  const missing = new Map<string, Set<string>>();
  const elsewhere = new Map<string, { module: string; menus: Set<string> }>();
  for (const menu of menusOf(edited)) {
    for (const ref of new Set(imageRefsIn(menu))) {
      if (!isWrittenName(ref)) continue;
      const reach = reachOf(ref, where);
      if (reach.kind === "none") {
        missing.set(ref, (missing.get(ref) ?? new Set()).add(menu.id));
      } else if (reach.kind === "module" && !ref.includes(":")) {
        const held = elsewhere.get(ref) ?? { module: reach.folder, menus: new Set<string>() };
        held.menus.add(menu.id);
        elsewhere.set(ref, held);
      }
    }
  }
  return [
    ...[...missing.entries()]
      .sort(([a], [b]) => byText(a, b))
      .map(([ref, menus]) => ({
        kind: "image_missing" as const,
        ref,
        menus: [...menus].sort(byText),
      })),
    ...[...elsewhere.entries()]
      .sort(([a], [b]) => byText(a, b))
      .map(([ref, held]) => ({
        kind: "image_elsewhere" as const,
        ref,
        module: held.module,
        menus: [...held.menus].sort(byText),
      })),
  ];
}
