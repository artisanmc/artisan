// Pure selectors for the workspace panel. File is named `useProjectDocuments`
// to anchor a future React-hook wrapper; for now only the pure
// `buildProjectDocuments` is needed (ProjectPanel calls it directly).
import type { Project } from "@/domain/types";
import { getFirstTitleText } from "@/domain/menuTitle";
import { getText } from "@/lib/i18n";

export type DocumentType = "menu" | "command" | "dialog";
export interface ProjectDocumentItem { id: string; label: string; type: DocumentType; onBoard: boolean; }
export interface ProjectDocumentGroup { type: DocumentType; items: ProjectDocumentItem[]; }

/** Human-readable label for any element id in the pack (menu/command/dialog), fallback to the id. */
export function documentLabel(pack: Project, id: string, activeLang: string): string {
  const menu = pack.menus?.find((m) => m.id === id);
  if (menu) { const lt = getFirstTitleText(menu); return (lt ? getText(pack, lt, activeLang) : "") || id; }
  const command = pack.commands?.find((c) => c.id === id);
  if (command) return `/${command.name}`;
  const dialog = pack.dialogs?.find((d) => d.id === id);
  if (dialog) return getText(pack, dialog.title, activeLang) || id;
  return id;
}

/** Pure: construit la liste catégorisée des éléments du pack (source de vérité du panneau). */
export function buildProjectDocuments(pack: Project, activeLang: string): ProjectDocumentGroup[] {
  const onBoard = (id: string) => id in pack.canvasLayout;
  // Menus are labelled by their id in the panel (their "title" is a visual
  // MenuTitleLayer[] — decorative, often empty or ambiguous — not a stable
  // identifier). Commands/dialogs keep their human label.
  const menus: ProjectDocumentItem[] = (pack.menus ?? []).map((m) => ({
    id: m.id, label: m.id, type: "menu", onBoard: onBoard(m.id),
  }));
  const commands: ProjectDocumentItem[] = (pack.commands ?? []).map((c) => ({
    id: c.id, label: documentLabel(pack, c.id, activeLang), type: "command", onBoard: onBoard(c.id),
  }));
  const dialogs: ProjectDocumentItem[] = (pack.dialogs ?? []).map((d) => ({
    id: d.id, label: documentLabel(pack, d.id, activeLang), type: "dialog", onBoard: onBoard(d.id),
  }));
  return [
    { type: "menu", items: menus },
    { type: "command", items: commands },
    { type: "dialog", items: dialogs },
  ];
}
