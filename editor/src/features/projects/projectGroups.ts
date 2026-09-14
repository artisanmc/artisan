import { ownerModuleOf } from "@/components/projectOwnership";
import { selectModuleNavEntries } from "@/distribution/moduleNav";
import type { Project } from "@/domain/types";
import { fallbackScreensFor } from "@/features/screens/screenList";
import type { ServerEditorScreen } from "@/lib/api/configScreens";
import type { ProjectSummary } from "@/lib/api/networks";
import { getModule } from "@artisan/editor-sdk";

export type OwnedProject = ProjectSummary & { ownerModule: string };

/**
 * Les ids lus sur le disque du serveur, présentés comme des Projects.
 *
 * Il n'y a rien d'autre à en dire : le nom du dossier EST l'identité, et le
 * backend n'en tient plus de fiche (ADR `server-disk-only-storage`). Les
 * champs qui décrivaient sa copie (`hash`) restent donc vides — une seule
 * fabrique pour que la sidebar et la page d'un serveur ne divergent pas.
 */
export function diskProjectsToSummaries(
  networkId: string,
  serverKeyId: string,
  projectIds: string[],
  metadata: ProjectSummary[] = [],
): ProjectSummary[] {
  const projects = projectIds.map(
    (id) =>
      metadata.find((project) => (project.externalId ?? project.id) === id) ?? {
        id,
        name: id,
        externalId: id,
        hash: "",
        networkId,
        serverKeyId,
      },
  );
  return [
    ...projects,
    ...metadata.filter(
      (project) => project.pendingRename && !projects.some((listed) => listed.id === project.id),
    ),
  ];
}

/** Une ligne sous un module. `label: null` = l'entrée « Éditeur » générique :
 *  le nom du module est déjà porté par l'en-tête du groupe. */
export type ModuleGroupEntry =
  | { kind: "project"; project: OwnedProject; label: string | null }
  | { kind: "screen"; screen: ServerEditorScreen }
  | { kind: "config"; moduleId: string };

export interface ModuleGroup {
  id: string;
  label: string;
  projects: OwnedProject[];
  screens: ServerEditorScreen[];
  /** Le module a une route éditeur (`/m/<id>`) → entrée « Configuration ». */
  hasScreen: boolean;
  entries: ModuleGroupEntry[];
  /** Tout le groupe tient en une seule entrée projet : une surface qui préfère
   *  une ligne unique l'affiche sous le nom du module (cas boutique). */
  collapsed: boolean;
}

export interface ProjectGroupsInput {
  /** Les Projects du serveur, déjà ordonnés par la surface appelante. */
  projects: ProjectSummary[];
  screens: ServerEditorScreen[];
  mountedModuleIds: string[];
  localProjects: Project[];
}

/**
 * Sépare les Projects ordinaires des Projects possédés par un Add-on
 * (ADR `addon-owned-project-roots`) et compose, pour chaque module installé,
 * son groupe : le canvas, ses Config screens (ADR `module-config-screens`) et
 * sa route de configuration.
 *
 * Fonction pure et partagée : la sidebar et la page d'un serveur affichent la
 * même chose parce qu'elles lisent la même liste, pas parce qu'on a recopié la
 * règle deux fois.
 */
export function buildProjectGroups({
  projects,
  screens,
  mountedModuleIds,
  localProjects,
}: ProjectGroupsInput): { flatProjects: ProjectSummary[]; moduleGroups: ModuleGroup[] } {
  const owned = projects.map((p) => ({ p, owner: ownerModuleOf(p, screens) }));
  const flatProjects = owned.filter((e) => !e.owner).map((e) => e.p);
  const ownedProjects: OwnedProject[] = owned
    .filter((e) => e.owner)
    .map((e) => ({ ...e.p, ownerModule: e.owner as string }));

  const nav = selectModuleNavEntries(mountedModuleIds);
  const navIds = nav.map((m) => m.id);
  const groupIds = Array.from(
    new Set<string>([...navIds, ...ownedProjects.map((p) => p.ownerModule)]),
  );

  const moduleGroups = groupIds.map((id) => {
    const groupProjects = ownedProjects.filter((p) => p.ownerModule === id);
    // Écrans déclarés à la Presence ; à défaut, écrans synthétisés depuis les
    // tables de modèles déclarés du project possédé.
    const declared = screens.filter((s) => s.moduleId === id);
    const groupScreens =
      declared.length > 0
        ? declared
        : fallbackScreensFor(
            id,
            groupProjects.map((p) => p.id),
            localProjects,
          );
    const hasScreen = navIds.includes(id);
    const entries: ModuleGroupEntry[] = [
      ...groupProjects.map(
        (project): ModuleGroupEntry => ({
          kind: "project",
          project,
          label: groupProjects.length === 1 ? null : project.name,
        }),
      ),
      ...groupScreens.map((screen): ModuleGroupEntry => ({ kind: "screen", screen })),
      ...(hasScreen ? [{ kind: "config", moduleId: id } as ModuleGroupEntry] : []),
    ];
    return {
      id,
      // Un module routable porte un libellé de sidebar ; sinon son displayName.
      // moduleNav ne liste que les modules AVEC un écran — repli sur le
      // displayName du module enregistré pour les autres (boutique).
      label: nav.find((m) => m.id === id)?.sidebar.label ?? getModule(id)?.displayName ?? id,
      projects: groupProjects,
      screens: groupScreens,
      hasScreen,
      entries,
      collapsed: entries.length === 1 && entries[0]!.kind === "project",
    };
  });

  return { flatProjects, moduleGroups };
}
