import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseDocKey } from "@/domain/documents";
import { isRequired, originStatus, shownTwin } from "@/domain/originals";
import type { Document, Project, ProjectId } from "@/domain/types";
import { documentCodec } from "@/schema/documentCodecs";
import { useProjectsStore } from "@/state/projectsStore";
import { GitCompare, Undo2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { stringify } from "yaml";

/** A Document as its file says it, without the id its path gives. */
function fileText(project: Project, kind: string, doc: Document): string {
  const {
    id: _id,
    folder: _folder,
    ...body
  } = documentCodec(kind).serialize(doc, project) as Record<string, unknown>;
  return stringify(body, { lineWidth: 0 });
}

/**
 * In a module that ships originals (design `originaux-modules`): whether the selected
 * Document is the module's version, the owner's over it, or the owner's own, and the way
 * back to the module's.
 */
export function OriginBar({
  projectId,
  project,
  docKey,
}: {
  projectId: ProjectId;
  project: Project;
  docKey: string;
}) {
  const { t } = useTranslation();
  const [comparing, setComparing] = useState(false);
  const ref = parseDocKey(docKey);
  if (!ref || !project.originals) return null;
  const status = originStatus(project, ref.kind, ref.id);
  if (!status) return null;
  const required = isRequired(project, ref.kind, ref.id);
  const twin = shownTwin(project, ref.kind, ref.id);
  const doc = project.documents[ref.kind]?.find((d) => d.id === ref.id);
  const badge =
    status === "modified" ? "badge badge-amber" : status === "added" ? "badge badge-sage" : "badge";
  return (
    <div
      data-testid="origin-bar"
      className="mx-3 mb-2 flex flex-col gap-1.5 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-inset)] p-2 text-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={badge}>{t(`originals.${status}`)}</span>
        {required && <span className="text-[var(--text-mut)]">{t("originals.required")}</span>}
      </div>
      {status === "modified" && twin && doc && (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => setComparing(true)}>
            <GitCompare className="size-4" /> {t("originals.compare")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title={t("originals.revertHint")}
            onClick={() => {
              if (!window.confirm(t("originals.revertConfirm"))) return;
              useProjectsStore.getState().revertToOriginal(projectId, ref.kind, ref.id);
            }}
          >
            <Undo2 className="size-4" /> {t("originals.revert")}
          </Button>
          <Dialog open={comparing} onOpenChange={setComparing}>
            <DialogContent className="max-h-[85vh] max-w-5xl overflow-hidden">
              <DialogHeader>
                <DialogTitle>{t("originals.compareTitle", { name: ref.id })}</DialogTitle>
                <DialogDescription>{t("originals.revertHint")}</DialogDescription>
              </DialogHeader>
              <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-2">
                {[
                  { label: t("originals.shipped"), text: fileText(project, ref.kind, twin) },
                  { label: t("originals.yours"), text: fileText(project, ref.kind, doc) },
                ].map((pane) => (
                  <div key={pane.label} className="flex min-h-0 flex-col gap-1">
                    <span className="field-label">{pane.label}</span>
                    <pre className="card max-h-[60vh] overflow-auto p-2 font-mono text-[11px] leading-snug select-text">
                      {pane.text}
                    </pre>
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}
