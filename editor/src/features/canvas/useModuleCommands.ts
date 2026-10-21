import type { Project } from "@/domain/types";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { useMemo } from "react";
import { type ModuleCommandNode, moduleCommandsOf, withModuleCommands } from "./moduleCommands";

/**
 * The module commands drawn on [project]'s board and the project as the board reads it
 * (`withModuleCommands`). Empty while the active server's commands are not loaded.
 */
export function useModuleCommands(project: Project | undefined): {
  nodes: ModuleCommandNode[];
  boardProject: Project | undefined;
} {
  const commands = useSystemCommandsStore((s) => s.commands);
  const overrides = useSystemCommandsStore((s) => s.overrides);
  const folders = useSystemCommandsStore((s) => s.folders);
  const nodes = useMemo(
    () => (project ? moduleCommandsOf(project, { commands, overrides, folders }) : []),
    [project, commands, overrides, folders],
  );
  const boardProject = useMemo(
    () => (project ? withModuleCommands(project, nodes) : project),
    [project, nodes],
  );
  return { nodes, boardProject };
}
