import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";
import { savePack } from "@/lib/packApi";
import { saveUserPack } from "@/lib/api/userPacks";
import type { Pack } from "@/domain/types";

export function usePackSaver(): (pack: Pack, files: Record<string, string>) => Promise<void> {
  const token = useSessionStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.currentUser);

  return async function save(pack: Pack, files: Record<string, string>): Promise<void> {
    if (token) {
      await savePack(token, pack, files);
    } else if (user) {
      await saveUserPack(pack.id, {
        hash: "", // recomputed server-side
        files,
        editor: pack,
      });
    } else {
      throw new Error("Not authenticated");
    }
  };
}
