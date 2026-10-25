import { findDocumentByKey } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { isCollectionKind } from "@/lib/documentCollections";
import { documentKindContribution } from "@artisan/editor-sdk";

/**
 * Whether a Document's own view is a stage: a menu, or a module kind whose node lists its
 * parts (`board.items`, a shop category's articles). There, its node is shown alone, a part
 * is selected by a click and edited in the Properties panel beside; the other kinds show
 * their view in place of the stage. A collection's Document (SDK 1.9) is a page, never a
 * stage: its kind has no node on the board, so none of its Documents opens on one.
 */
export function opensOnStage(project: Project, key: string): boolean {
  const found = findDocumentByKey(project, key);
  if (!found || isCollectionKind(found.kind)) return false;
  return found.kind === "menu" || documentKindContribution(found.kind)?.board?.items != null;
}
