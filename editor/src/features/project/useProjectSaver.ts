import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";
import { saveProject } from "@/lib/projectApi";
import { saveUserProject } from "@/lib/api/userProjects";
import type { Project } from "@/domain/types";

export function useProjectSaver(): (pack: Project, files: Record<string, string>) => Promise<void> {
  const token = useSessionStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.currentUser);

  return async function save(pack: Project, files: Record<string, string>): Promise<void> {
    if (token) {
      await saveProject(token, pack, files);
    } else if (user) {
      await saveUserProject(pack.id, {
        hash: "", // recomputed server-side
        files,
        editor: pack,
      });
    } else {
      throw new Error("Not authenticated");
    }
  };
}
