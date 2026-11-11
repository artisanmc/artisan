import { documentsOf } from "@/domain/documents";
import type { ModelField } from "@/domain/types";
import type { ModuleVariable } from "@/lib/api/moduleVariables";
import type { Variable } from "@/modules/variables/variable";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerVariablesStore } from "@/state/serverVariablesStore";
import { useRouter } from "@tanstack/react-router";
import { useMemo } from "react";

/**
 * A Variable as the pickers offer it (ADR `triggers-and-variables` §5, §10): a Project variable
 * of the open project (`last_death`, written by `set_var`) or one a module of the active server
 * declares (`guilds.rank`, read-only). The name is what `var.` is followed by.
 */
export interface VariableChoice {
  name: string;
  type: "string" | "number" | "boolean" | "location";
  /** `project`: a `variables/<id>.yml` of the open project; `module`: declared by a module. */
  source: "project" | "module";
  values: string[];
  key: ModelField | null;
  description: Record<string, string>;
}

export function projectVariableChoice(v: Variable): VariableChoice {
  return { name: v.id, type: v.type, source: "project", values: [], key: null, description: {} };
}

export function moduleVariableChoice(v: ModuleVariable): VariableChoice {
  return {
    name: v.name,
    type: v.type,
    source: "module",
    values: v.values,
    key: v.key,
    description: v.description,
  };
}

/** The Variables of project `projectId` (its `variable` Documents). */
export function useProjectVariables(projectId: string | undefined): Variable[] {
  const project = useProjectsStore((s) =>
    projectId ? s.openProjects.projects.find((p) => p.id === projectId) : undefined,
  );
  return useMemo(() => documentsOf(project, "variable") as unknown as Variable[], [project]);
}

/**
 * Every Variable the open page can read: the open project's (from the route), then the active
 * server's module Variables. A project Variable named like a module hides that module's, as on
 * the server. `ready`: the server's list has arrived (a module name it lacks is then dead).
 */
export function useVariableChoices(): { choices: VariableChoice[]; ready: boolean } {
  // The route's project, read without subscribing: a widget outside the router (a test, a
  // dialog) gets the module Variables alone. Changing project remounts the page.
  const router = useRouter({ warn: false });
  const projectId = router?.state.matches
    .map((m) => (m.params as { projectId?: string }).projectId)
    .find(Boolean);
  const project = useProjectVariables(projectId);
  const modules = useServerVariablesStore((s) => s.variables);
  const ready = useServerVariablesStore((s) => s.status === "ready");
  const choices = useMemo(() => {
    const own = project.map(projectVariableChoice);
    const hidden = new Set(own.map((v) => v.name));
    return [...own, ...modules.filter((m) => !hidden.has(m.moduleId)).map(moduleVariableChoice)];
  }, [project, modules]);
  return { choices, ready };
}
