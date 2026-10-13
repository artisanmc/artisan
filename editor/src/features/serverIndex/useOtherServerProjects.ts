import { projectNamespace } from "@/domain/docRef";
import type { Project } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useMemo } from "react";
import { useServerIndexStore } from "./serverIndexStore";

/**
 * The server's other projects (published state, server index), without the
 * edited project: that one is read live from the account, never twice.
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
