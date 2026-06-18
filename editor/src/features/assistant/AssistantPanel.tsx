import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ProjectId } from "@/domain/types";
import { AssistantBody } from "@/features/assistant/AssistantBody";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useUiStore } from "@/state/uiStore";
import { useTranslation } from "react-i18next";

/**
 * AssistantPanel — MOBILE presentation of the AI assistant: a right-side drawer
 * (`Sheet`). On desktop (≥lg) the assistant is an inline resizable pane
 * (`AssistantPane`, mounted by the project route via `SplitPane`), so the
 * drawer must stay closed there — `open` is gated on `!isDesktop` to avoid
 * showing both presentations at once. Open state lives in
 * `uiStore.assistantPanelOpen` (toggled by the top-bar Sparkles button).
 */
export function AssistantPanel({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.assistantPanelOpen);
  const setOpen = useUiStore((s) => s.setAssistantPanelOpen);
  const isDesktop = useIsDesktop();

  return (
    <Sheet open={open && !isDesktop} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="flex w-full max-w-md flex-col sm:w-[420px] sm:max-w-md"
        aria-label={t("assistant.title")}
      >
        <SheetHeader>
          <SheetTitle>{t("assistant.title")}</SheetTitle>
        </SheetHeader>
        <AssistantBody projectId={projectId} />
      </SheetContent>
    </Sheet>
  );
}
