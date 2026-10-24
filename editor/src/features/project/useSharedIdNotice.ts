import { sharedDocumentIds } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/** The collisions already told, per project: a notice once per load, not per render. */
const told = new Map<string, string>();

/** `shop (menu, command)`, one per shared id. */
export function sharedIdList(project: Pick<Project, "documents">): string {
  return sharedDocumentIds(project)
    .map(({ id, kinds }) => `${id} (${kinds.join(", ")})`)
    .join(", ");
}

/**
 * Tells, when a folder loads, which ids two kinds of Documents share. The editor keys each
 * Document by kind and id, so nothing merges; the notice says why a search or a link label
 * shows the same id twice.
 */
export function useSharedIdNotice(project: Project | null | undefined): void {
  const { t } = useTranslation();
  const list = project ? sharedIdList(project) : "";
  const id = project?.id;
  useEffect(() => {
    if (!id || !list || told.get(id) === list) return;
    told.set(id, list);
    toast.warning(t("canvas.sharedDocumentIds", { list }), { duration: 10_000 });
  }, [id, list, t]);
}
