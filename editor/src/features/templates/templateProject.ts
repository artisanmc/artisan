import { commandsOf, menusOf } from "@/domain/documents";
import type { Project, ProjectId } from "@/domain/types";
import {
  CLIPBOARD_VERSION,
  type ClipboardPayload,
  type ElementCopy,
  collectTexts,
} from "@/features/canvas/clipboard";
import { MODULE_FILE } from "@/lib/yamlFiles";
import { projectFromFiles } from "@/schema/projectFromFiles";

const MANIFEST =
  "schema: module/v1\ndefault_lang: en\nlanguages: [en]\nfiles:\n  menus: []\n  commands: []\n";

/**
 * A template's default version as a Project, never stored nor saved: read to pick the
 * menus, commands and items to copy (ADR `module-templates`).
 */
export function templateProject(
  moduleId: string,
  templateId: string,
  files: Record<string, string>,
): Project {
  const id = `__template__${moduleId}_${templateId}` as ProjectId;
  const base = `plugins/Artisan/projects/${id}`;
  const map: Record<string, string> = { [`${base}/${MODULE_FILE}`]: MANIFEST };
  for (const [path, content] of Object.entries(files)) map[`${base}/${path}`] = content;
  return projectFromFiles(id, map, { name: templateId });
}

/** What can be picked from a template's default version: its menus with their items, and its commands. */
export interface TemplatePickable {
  menus: { id: string; elements: string[] }[];
  commands: string[];
}

export function pickable(project: Project): TemplatePickable {
  return {
    menus: menusOf(project).map((m) => ({
      id: m.id,
      elements: m.layers.flatMap((l) => l.elements.map((e) => e.id)),
    })),
    commands: commandsOf(project).map((c) => c.id),
  };
}

/**
 * The clipboard holding the picked entities of the default version, with their texts: pasted
 * on the board of any Project (Ctrl+V), like a copy made there. A menu picked whole takes its
 * items with it; items picked alone paste into the selected menu.
 */
export function templateClipboard(
  project: Project,
  pick: { menus: string[]; commands: string[]; elements: { menuId: string; elementId: string }[] },
): ClipboardPayload {
  const menus = menusOf(project).filter((m) => pick.menus.includes(m.id));
  const commands = commandsOf(project).filter((c) => pick.commands.includes(c.id));
  const elements: ElementCopy[] = [];
  for (const { menuId, elementId } of pick.elements) {
    if (pick.menus.includes(menuId)) continue;
    const menu = menusOf(project).find((m) => m.id === menuId);
    const element = menu?.layers.flatMap((l) => l.elements).find((e) => e.id === elementId);
    if (menu && element) elements.push({ sourceMenuId: menu.id, element });
  }
  return {
    kind: "artisan.clipboard",
    version: CLIPBOARD_VERSION,
    menus,
    commands,
    elements,
    texts: collectTexts(project, { menus, commands, elements }),
  };
}
