import { rekeyProject } from "@/domain/i18nSites";
import type { Project } from "@/domain/types";
import { transform } from "@/features/export/transform";
import { saveUserProject } from "@/lib/api/userProjects";
import { saveProject } from "@/lib/projectApi";

/**
 * Persist a single pack via the correct auth path: the session-token endpoint
 * (plugin trust-dance) or the user-cookie endpoint (web login). Shared by the
 * debounced auto-save (`useProjectAutoSave`) and any flow that needs an immediate,
 * durable write — notably the AI assistant, whose generated menus must survive a
 * reload right away (the 2s debounce window otherwise loses them).
 *
 * No-op when neither auth mode is available. Throws on transport failure;
 * callers decide whether to surface it.
 */
export async function persistProject(
  pack: Project,
  token: string | null,
  hasUser: boolean,
): Promise<void> {
  if (!token && !hasUser) return;
  const cloned = structuredClone(pack);
  rekeyProject(cloned);
  const files = transform(cloned);
  if (token) {
    // Session mode (trust dance): the editor_session token authorises this.
    await saveProject(token, pack, files);
  } else {
    // User-auth mode: cookie-based call; membership is checked server-side.
    await saveUserProject(pack.id, { hash: "", files, editor: pack });
  }
}
