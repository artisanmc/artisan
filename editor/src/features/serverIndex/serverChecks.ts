import type { Project } from "@/domain/types";
import { deriveServerGraph, documentKey } from "@/features/canvas/serverGraph";
import { namespaceOf } from "./serverIndex";

export interface IssueOwner {
  namespace: string;
  projectName: string;
  docId: string;
}

export type ServerIssue =
  /** Deux commandes revendiquent le même nom ou alias : le jeu n'en garde qu'une. */
  | { kind: "command_conflict"; name: string; owners: IssueOwner[] }
  /** Un menu ou un dialog porte le même id dans deux projects : le jeu n'en garde qu'un. */
  | { kind: "duplicate_id"; docKind: "menu" | "dialog"; id: string; owners: IssueOwner[] }
  /** Un lien du project édité ne mène nulle part de sûr. */
  | {
      kind: "broken_link";
      reason: "missing" | "ambiguous";
      targetId: string;
      from: { docId: string; docKind: "menu" | "command" | "dialog" };
    };

export interface ServerChecks {
  /**
   * `pending` / `unavailable` : les contrôles n'ont **pas** été faits — l'absence
   * de problème ne doit alors jamais se lire comme un feu vert. `none` : aucun
   * index à attendre (hors serveur).
   */
  status: "ready" | "pending" | "unavailable" | "none";
  issues: ServerIssue[];
  /** Projects que l'index n'a pas pu lire : les contrôles sont alors incomplets. */
  unreadable: string[];
}

export function serverChecksFor(
  edited: Project,
  index: {
    status: "idle" | "loading" | "ready" | "unavailable";
    projects: Project[];
    failed: string[];
  },
): ServerChecks {
  switch (index.status) {
    case "ready":
      return {
        status: "ready",
        issues: checkServerIssues(edited, index.projects),
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
 * Ce qu'un déploiement du project `edited` risquerait de casser **sur le
 * serveur**, vu par aucun contrôle d'un seul project : le plugin range les menus,
 * les dialogs et les commandes dans des tables uniques, sans notion de project.
 *
 * `edited` est son état de travail ; `others` l'état publié des autres projects.
 * Ne sont rapportés que les problèmes qui impliquent `edited` — un conflit entre
 * deux autres projects existe déjà, et ce déploiement n'en est pas la cause.
 * Ce sont des avertissements : rien ici n'empêche de déployer.
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

/** Le nom sous lequel le jeu enregistre une commande : `name`, sinon son id. */
const triggerName = (c: { id: string; name: string }) => (c.name || c.id).toLowerCase();

function commandConflicts(all: Project[], editedNamespace: string): ServerIssue[] {
  const byTrigger = new Map<string, Map<string, IssueOwner>>();
  for (const project of all) {
    for (const command of project.commands ?? []) {
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
      const docs = docKind === "menu" ? (project.menus ?? []) : (project.dialogs ?? []);
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
  const prefix = documentKey(edited.id, "");
  const kindOf = (docId: string): "menu" | "command" | "dialog" =>
    (edited.menus ?? []).some((m) => m.id === docId)
      ? "menu"
      : (edited.commands ?? []).some((c) => c.id === docId)
        ? "command"
        : "dialog";
  return deriveServerGraph(all)
    .unresolved.filter((u) => u.source.startsWith(prefix))
    .map((u) => {
      const docId = u.source.slice(prefix.length);
      return {
        kind: "broken_link" as const,
        reason: u.reason,
        targetId: u.targetId,
        from: { docId, docKind: kindOf(docId) },
      };
    })
    .sort((a, b) => byText(a.from.docId, b.from.docId) || byText(a.targetId, b.targetId));
}
