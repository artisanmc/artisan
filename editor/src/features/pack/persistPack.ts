import type { Pack } from "@/domain/types";
import { transform } from "@/features/export/transform";
import { saveUserPack } from "@/lib/api/userPacks";
import { rekeyCommandLTexts, rekeyMenuLTexts } from "@/lib/i18nKeys";
import { savePack } from "@/lib/packApi";

/**
 * Persist a single pack via the correct auth path: the session-token endpoint
 * (plugin trust-dance) or the user-cookie endpoint (web login). Shared by the
 * debounced auto-save (`usePackAutoSave`) and any flow that needs an immediate,
 * durable write — notably the AI assistant, whose generated menus must survive a
 * reload right away (the 2s debounce window otherwise loses them).
 *
 * No-op when neither auth mode is available. Throws on transport failure;
 * callers decide whether to surface it.
 */
export async function persistPack(
  pack: Pack,
  token: string | null,
  hasUser: boolean,
): Promise<void> {
  if (!token && !hasUser) return;
  const cloned = structuredClone(pack);
  for (const menu of cloned.menus) rekeyMenuLTexts(cloned, menu);
  for (const cmd of cloned.commands) rekeyCommandLTexts(cloned, cmd);
  const files = transform(cloned);
  if (token) {
    // Session mode (trust dance): the editor_session token authorises this.
    await savePack(token, pack, files);
  } else {
    // User-auth mode: cookie-based call; membership is checked server-side.
    await saveUserPack(pack.id, { hash: "", files, editor: pack });
  }
}
