// Pure selectors for the workspace panel. File is named `useProjectDocuments`
// to anchor a future React-hook wrapper; for now only the pure
// `buildProjectDocuments` is needed (ProjectPanel calls it directly).
import type { Project } from "@/domain/types";
import { getFirstTitleText } from "@/domain/menuTitle";
import { getText } from "@/lib/i18n";

export type DocumentType = "menu" | "command" | "dialog";
export interface ProjectDocumentItem { id: string; label: string; type: DocumentType; onBoard: boolean; }
export interface ProjectDocumentGroup { type: DocumentType; items: ProjectDocumentItem[]; }

/** Human-readable label for any element id in the project (menu/command/dialog), fallback to the id. */
export function documentLabel(project: Project, id: string, activeLang: string): string {
  const menu = project.menus?.find((m) => m.id === id);
  if (menu) { const lt = getFirstTitleText(menu); return (lt ? getText(project, lt, activeLang) : "") || id; }
  const command = project.commands?.find((c) => c.id === id);
  if (command) return `/${command.name}`;
  const dialog = project.dialogs?.find((d) => d.id === id);
  if (dialog) return getText(project, dialog.title, activeLang) || id;
  return id;
}

/** Pure: construit la liste catégorisée des éléments du project (source de vérité du panneau). */
export function buildProjectDocuments(project: Project, activeLang: string): ProjectDocumentGroup[] {
  const onBoard = (id: string) => id in project.canvasLayout;
  // Menus and dialogs are labelled by their id in the panel (their title is
  // decorative, often empty or ambiguous — not a stable identifier).
  // Commands keep their human label (`/name` IS their identifier).
  const menus: ProjectDocumentItem[] = (project.menus ?? []).map((m) => ({
    id: m.id, label: m.id, type: "menu", onBoard: onBoard(m.id),
  }));
  const commands: ProjectDocumentItem[] = (project.commands ?? []).map((c) => ({
    id: c.id, label: documentLabel(project, c.id, activeLang), type: "command", onBoard: onBoard(c.id),
  }));
  const dialogs: ProjectDocumentItem[] = (project.dialogs ?? []).map((d) => ({
    id: d.id, label: d.id, type: "dialog", onBoard: onBoard(d.id),
  }));
  return [
    { type: "menu", items: menus },
    { type: "command", items: commands },
    { type: "dialog", items: dialogs },
  ];
}
