import { useAuthStore } from "@/state/authStore";
import { saveUserProject } from "@/lib/api/userProjects";
import type { Project } from "@/domain/types";

export function useProjectSaver(): (project: Project, files: Record<string, string>) => Promise<void> {
  const user = useAuthStore((s) => s.currentUser);

  return async function save(project: Project, files: Record<string, string>): Promise<void> {
    if (!user) throw new Error("Not authenticated");
    await saveUserProject(project.id, {
      hash: "", // recomputed server-side
      files,
    });
  };
}
