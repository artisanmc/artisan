import type { PackId } from "@/domain/types";
import { AssistantBody } from "@/features/assistant/AssistantBody";
import { useUiStore } from "@/state/uiStore";
import { Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * AssistantPane — DESKTOP presentation of the AI assistant: a full-height
 * column (header + chat) rendered by the workspace route as the resizable
 * secondary pane of a `SplitPane`, at the same level as the canvas. The mobile
 * presentation is `AssistantPanel` (a right-side drawer). Both wrap the same
 * `AssistantChat` body. Open/close state lives in `uiStore.assistantPanelOpen`.
 */
export function AssistantPane({ packId }: { packId: PackId }) {
  const { t } = useTranslation();
  const setOpen = useUiStore((s) => s.setAssistantPanelOpen);
  return (
    <div data-testid="assistant-pane" className="flex h-full min-h-0 flex-col bg-[var(--surface)]">
      {/* Header height matches the workspace top bar (52px) so the chat aligns. */}
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-[var(--border-soft)] px-4">
        <span className="flex items-center gap-2 font-semibold text-[13px] text-[var(--text)]">
          <Sparkles className="h-4 w-4 text-[var(--brand)]" />
          {t("assistant.title")}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("assistant.close")}
          className="flex size-7 items-center justify-center rounded-[8px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <AssistantBody packId={packId} />
    </div>
  );
}
