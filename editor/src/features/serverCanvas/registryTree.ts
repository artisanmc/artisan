import type { Project } from "@/domain/types";
import type { BoardEdge, DocumentKind } from "@/features/canvas/serverGraph";
import { documentKey } from "@/features/canvas/serverGraph";
import { buildProjectDocuments } from "@/features/project/useProjectDocuments";
import type { ServerEditorScreen } from "@/lib/api/configScreens";
import type { BoardFilter } from "./boardFilter";
import { matchesQuery } from "./boardFilter";

/**
 * Le registre serveur : l'arbre unique qui remplace, sur la planche serveur, la
 * liste des projects/modules de la sidebar ET le rail des Documents d'un
 * project (spec `server-registry-and-derived-canvas`, décision 10 bis).
 *
 * Un groupe par project ordinaire, un groupe par module installé (ses projects
 * possédés + ses Config screens). La case d'un groupe est le filtre de la
 * planche : elle masque ou montre tous ses projects d'un coup.
 */

export interface RegistryItem {
  /** Clé qualifiée du nœud sur la planche (`documentKey`). */
  key: string;
  projectId: string;
  docId: string;
  kind: DocumentKind;
  label: string;
  /** Aucune arête visible : le Document est en gouttière (« Pas encore reliés »). */
  linked: boolean;
}

export interface RegistrySection {
  kind: DocumentKind;
  items: RegistryItem[];
}

export interface RegistryGroup {
  /** L'id du project, ou `module:<id>` pour le groupe d'un module. */
  id: string;
  label: string;
  moduleId: string | null;
  /** Les `Project.id` couverts par la case du groupe. */
  projectIds: string[];
  /** Tous les projects du groupe sont décochés. */
  hidden: boolean;
  sections: RegistrySection[];
  screens: ServerEditorScreen[];
}

export interface RegistryEntry {
  project: Project;
  /** Module propriétaire (ADR `addon-owned-project-roots`), `null` si ordinaire. */
  ownerModule: string | null;
}

export interface RegistryModule {
  id: string;
  label: string;
  screens: ServerEditorScreen[];
}

export interface RegistryInput {
  /** Projects chargés, dans l'ordre d'affichage voulu. */
  entries: RegistryEntry[];
  /** Modules installés, y compris ceux qui ne possèdent aucun project. */
  modules: RegistryModule[];
  /** Arêtes de la planche telle qu'affichée : elles décident de la gouttière. */
  edges: BoardEdge[];
  filter: BoardFilter;
  activeLang: string;
}

const KIND_ORDER: DocumentKind[] = ["menu", "command", "dialog"];

export function buildRegistry({ entries, modules, edges, filter, activeLang }: RegistryInput): {
  groups: RegistryGroup[];
  unlinked: RegistryItem[];
} {
  const hidden = new Set(filter.hide ?? []);
  const narrowed = Boolean(filter.q || filter.kind);
  const linked = new Set<string>();
  for (const e of edges) {
    linked.add(e.source);
    linked.add(e.target);
  }

  const itemsOf = (project: Project): RegistryItem[] =>
    buildProjectDocuments(project, activeLang).flatMap((g) =>
      g.items.map((it) => {
        const key = documentKey(project.id, it.id);
        return {
          key,
          projectId: project.id,
          docId: it.id,
          kind: g.type,
          label: it.label,
          linked: linked.has(key),
        };
      }),
    );

  const keep = (item: RegistryItem) =>
    (!filter.kind || item.kind === filter.kind) && matchesQuery(filter.q, item.docId, item.label);

  const makeGroup = (
    id: string,
    label: string,
    moduleId: string | null,
    projects: Project[],
    screens: ServerEditorScreen[],
  ): RegistryGroup => {
    const items = projects.flatMap(itemsOf).filter(keep);
    const projectIds = projects.map((p) => p.id as string);
    return {
      id,
      label,
      moduleId,
      projectIds,
      hidden: projectIds.length > 0 && projectIds.every((p) => hidden.has(p)),
      sections: KIND_ORDER.map((kind) => ({
        kind,
        items: items.filter((i) => i.kind === kind),
      })).filter((s) => s.items.length > 0),
      screens: screens.filter((s) => matchesQuery(filter.q, s.id, s.label)),
    };
  };

  const ordinary = entries
    .filter((e) => !e.ownerModule)
    .map((e) => makeGroup(e.project.id, e.project.name, null, [e.project], []));

  const moduleIds = [
    ...modules.map((m) => m.id),
    ...entries.map((e) => e.ownerModule).filter((m): m is string => m != null),
  ].filter((id, i, all) => all.indexOf(id) === i);
  const moduleGroups = moduleIds.map((id) => {
    const mod = modules.find((m) => m.id === id);
    const projects = entries.filter((e) => e.ownerModule === id).map((e) => e.project);
    return makeGroup(`module:${id}`, mod?.label ?? id, id, projects, mod?.screens ?? []);
  });

  // Filtre texte ou type actif : un groupe qui ne contient plus rien n'a rien à
  // montrer. Sans filtre, un groupe vide reste — c'est là qu'on crée.
  const groups = [...ordinary, ...moduleGroups].filter(
    (g) => !narrowed || g.sections.length > 0 || g.screens.length > 0,
  );

  const unlinked = groups
    .filter((g) => !g.hidden)
    .flatMap((g) => g.sections.flatMap((s) => s.items))
    .filter((i) => !i.linked && !hidden.has(i.projectId));

  return { groups, unlinked };
}

/** La case d'un groupe : décoche (masque) ou recoche (montre) tous ses projects. */
export function toggleGroup(filter: BoardFilter, group: RegistryGroup): BoardFilter {
  const hidden = new Set(filter.hide ?? []);
  for (const id of group.projectIds) {
    if (group.hidden) hidden.delete(id);
    else hidden.add(id);
  }
  return { ...filter, hide: hidden.size > 0 ? [...hidden].sort() : undefined };
}

/**
 * Sélectionner un Document depuis le registre. Si son project est masqué, on le
 * remontre : naviguer vers un Document invisible n'aurait aucun sens, et le
 * remontrer en silence vaut mieux que refuser le geste.
 */
export function selectDocument(filter: BoardFilter, item: RegistryItem): BoardFilter {
  const hide = (filter.hide ?? []).filter((id) => id !== item.projectId);
  return { ...filter, hide: hide.length > 0 ? hide : undefined, doc: item.key };
}
