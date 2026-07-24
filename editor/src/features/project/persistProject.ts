import { rekeyProject } from "@/domain/i18nSites";
import type { Project } from "@/domain/types";
import { transform } from "@/features/export/transform";
import { saveUserProject } from "@/lib/api/userProjects";

/**
 * Persist a single pack via the user-cookie endpoint (web login). Shared by
 * the debounced auto-save (`useProjectAutoSave`) and any flow that needs an
 * immediate, durable write — notably the AI assistant, whose generated menus
 * must survive a reload right away (the 2s debounce window otherwise loses
 * them).
 *
 * No-op when there's no signed-in user. Throws on transport failure; callers
 * decide whether to surface it.
 */
export async function persistProject(pack: Project, hasUser: boolean): Promise<void> {
  if (!hasUser) return;
  const cloned = structuredClone(pack);
  rekeyProject(cloned);
  const files = transform(cloned);
  await saveUserProject(pack.id, { hash: "", files });
}
