import { projectNamespace } from "@/domain/docRef";
import type { Project } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useMemo } from "react";
import { useServerIndexStore } from "./serverIndexStore";

/**
 * Les autres projects du serveur (état publié, index serveur), sans le project
 * édité : lui se lit en direct dans le compte, jamais en double.
 */
export function useOtherServerProjects(projectId: string): Project[] {
  const namespace = useAccountStore((s) => {
    const edited = s.account.projects.find((p) => p.id === projectId);
    return edited ? projectNamespace(edited) : projectId;
  });
  const projects = useServerIndexStore((s) => s.projects);
  return useMemo(
    () => projects.filter((p) => projectNamespace(p) !== namespace),
    [projects, namespace],
  );
}
