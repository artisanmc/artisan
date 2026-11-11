import type { Project } from "@/domain/types";
import { systemDocuments } from "@/lib/systemDocuments";
import { useModulesStore } from "@/state/modulesStore";
import { useProjectTemplatesStore } from "@/state/projectTemplatesStore";
import { useMemo } from "react";

/** [project]'s Documents that are a module's system elements, by key (`docKey`), with that module. */
export function useSystemDocuments(project: Project | undefined): Map<string, string> {
  const modules = useModulesStore((s) => s.active);
  const origins = useProjectTemplatesStore((s) =>
    project ? s.entries[project.id]?.origins : undefined,
  );
  return useMemo(
    () => (project && origins ? systemDocuments(project, modules, origins) : new Map()),
    [project, modules, origins],
  );
}
