import { parseDocKey } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { collectionLabel, misplacedCollectionDocuments } from "@/lib/documentCollections";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { documentKindContribution } from "@artisan/editor-sdk";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/**
 * Files back at the root every collection Document found in a themed folder (SDK 1.9): its
 * module reads them there only, so a category left in `catalogue/` was invisible to the
 * shop. The move goes into the draft like any other, and Deploy writes it.
 */
export function useCollectionsAtRoot(project: Project | null | undefined) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!project) return;
    const misplaced = misplacedCollectionDocuments(project);
    if (misplaced.length === 0) return;
    useProjectsStore
      .getState()
      .moveToFolder({ projectId: project.id, nodeIds: misplaced, folder: "" });
    const byKind = new Map<string, number>();
    for (const key of misplaced) {
      const kind = parseDocKey(key)!.kind;
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
    const lang = useUiStore.getState().editorLang;
    for (const [kind, count] of byKind) {
      const collection = collectionLabel(documentKindContribution(kind), kind, lang);
      toast.info(t("collections.movedToRoot", { count, collection }));
    }
  }, [project, t]);
}
