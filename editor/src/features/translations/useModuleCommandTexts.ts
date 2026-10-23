import type { Project } from "@/domain/types";
import { OVERRIDES_NAMESPACE, overridePath, withOverrideFile } from "@/lib/commandOverride";
import { type CommandTextRow, commandTextRows, withTexts } from "@/lib/moduleCommandTexts";
import { moduleCommandEntriesOf } from "@/lib/moduleCommands";
import { useProjectsStore } from "@/state/projectsStore";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { useMemo } from "react";

export interface ModuleCommandTexts {
  /** The folder's module command texts, as its draft holds them. */
  rows: CommandTextRow[];
  edit: (key: string, lang: string, text: string) => void;
}

/**
 * The texts of the module commands shown in [project]'s folder, for its Translations tab
 * (design `framework-commandes`): read from their override files in the folder's draft, else
 * from the module. An edit rewrites the override file in that draft, deployed with the rest
 * of the folder.
 */
export function useModuleCommandTexts(project: Project | undefined): ModuleCommandTexts {
  const commands = useSystemCommandsStore((s) => s.commands);
  const overrides = useSystemCommandsStore((s) => s.overrides);
  const folders = useSystemCommandsStore((s) => s.folders);
  const setModuleData = useProjectsStore((s) => s.setModuleData);

  const rows = useMemo(
    () =>
      project
        ? commandTextRows(moduleCommandEntriesOf(project, { commands, overrides, folders }))
        : [],
    [project, commands, overrides, folders],
  );

  const edit = (key: string, lang: string, text: string) => {
    const row = rows.find((r) => r.key === key);
    if (!project || !row) return;
    const { entry, field } = row;
    const content = withTexts(entry, { [field]: { ...row.values, [lang]: text } });
    // These commands show in this folder: their overrides live here, or go here.
    const folder = project.diskId ?? project.id;
    const path =
      entry.override?.folder === folder ? entry.override.path : overridePath(entry.command.id);
    setModuleData(project.id, OVERRIDES_NAMESPACE, withOverrideFile(project, path, content));
  };

  return { rows, edit };
}
