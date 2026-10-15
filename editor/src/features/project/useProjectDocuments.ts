// Pure selectors for the workspace panel. File is named `useProjectDocuments`
// to anchor a future React-hook wrapper; for now only the pure
// `buildProjectDocuments` is needed (ProjectPanel calls it directly).
import type { Project } from "@/domain/types";
import { getFirstTitleText } from "@/domain/menuTitle";
import { getText } from "@/lib/i18n";
import { commandsOf, dialogsOf, menusOf } from "@/domain/documents";

export type DocumentType = "menu" | "command" | "dialog";
export interface ProjectDocumentItem {
  id: string;
  label: string;
  type: DocumentType;
}
export interface ProjectDocumentGroup {
  type: DocumentType;
  items: ProjectDocumentItem[];
}

/** Human-readable label for any element id in the project (menu/command/dialog), fallback to the id. */
export function documentLabel(project: Project, id: string, activeLang: string): string {
  const menu = menusOf(project).find((m) => m.id === id);
  if (menu) {
    const lt = getFirstTitleText(menu);
    return (lt ? getText(project, lt, activeLang) : "") || id;
  }
  const command = commandsOf(project).find((c) => c.id === id);
  if (command) return `/${command.name}`;
  const dialog = dialogsOf(project).find((d) => d.id === id);
  if (dialog) return getText(project, dialog.title, activeLang) || id;
  return id;
}

/** Pure: builds the project's categorised element list (the panel's source of truth). */
export function buildProjectDocuments(
  project: Project,
  activeLang: string,
): ProjectDocumentGroup[] {
  // Menus and dialogs are labelled by their id in the panel (their title is
  // decorative, often empty or ambiguous — not a stable identifier).
  // Commands keep their human label (`/name` IS their identifier).
  const menus: ProjectDocumentItem[] = menusOf(project).map((m) => ({
    id: m.id,
    label: m.id,
    type: "menu",
  }));
  const commands: ProjectDocumentItem[] = commandsOf(project).map((c) => ({
    id: c.id,
    label: documentLabel(project, c.id, activeLang),
    type: "command",
  }));
  const dialogs: ProjectDocumentItem[] = dialogsOf(project).map((d) => ({
    id: d.id,
    label: d.id,
    type: "dialog",
  }));
  return [
    { type: "menu", items: menus },
    { type: "command", items: commands },
    { type: "dialog", items: dialogs },
  ];
}
