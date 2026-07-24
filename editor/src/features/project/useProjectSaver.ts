import { useAuthStore } from "@/state/authStore";
import { saveUserProject } from "@/lib/api/userProjects";
import type { Project } from "@/domain/types";

export function useProjectSaver(): (pack: Project, files: Record<string, string>) => Promise<void> {
  const user = useAuthStore((s) => s.currentUser);

  return async function save(pack: Project, files: Record<string, string>): Promise<void> {
    if (!user) throw new Error("Not authenticated");
    await saveUserProject(pack.id, {
      hash: "", // recomputed server-side
      files,
    });
  };
}
