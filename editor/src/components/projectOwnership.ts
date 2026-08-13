import type { ServerEditorScreen } from "@/lib/api/configScreens";

/**
 * Le module propriétaire d'un Project (ADR `addon-owned-project-roots`), ou
 * `undefined` pour un project ordinaire.
 *
 * Il se lisait autrefois dans le `manifest.module` de la copie backend. Cette
 * copie n'existe plus (ADR `server-disk-only-storage`) et la relire coûterait un
 * aller-retour disque par Project juste pour peupler une sidebar. On la redérive
 * donc des **écrans déclarés**, où le module a lui-même annoncé le project qu'il
 * possède — la même donnée de Presence qui fait déjà exister son groupe.
 *
 * Le rapprochement se fait sur l'**id disque** : c'est celui que le module
 * déclare, et il diffère de l'id interne dès qu'un autre serveur a déjà réclamé
 * le même nom (cf. `projects.externalId`).
 */
export function ownerModuleOf(
  project: { id: string; externalId?: string | null; ownerModule?: string },
  screens: ServerEditorScreen[],
): string | undefined {
  if (project.ownerModule) return project.ownerModule;
  const diskId = project.externalId ?? project.id;
  return screens.find((s) => s.projectId === diskId && s.moduleId)?.moduleId ?? undefined;
}
