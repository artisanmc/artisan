import { Button } from "@/components/ui/button";
import type { ProjectId } from "@/domain/types";
import { FlowCanvas } from "@/features/flow/FlowCanvas";
import { dismissInspector } from "@/features/project/projectSettings";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

export function EditorPane({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={t("projectLibrary.properties")}>
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <h2 className="text-sm font-medium">{t("projectLibrary.properties")}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid="editor-pane-close"
          onClick={dismissInspector}
          aria-label={t("editorPane.close")}
          title={t("editorPane.close")}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <FlowCanvas projectId={projectId} />
      </div>
    </section>
  );
}
