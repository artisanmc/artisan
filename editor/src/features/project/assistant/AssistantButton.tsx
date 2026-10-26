import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AssistantPanel } from "./AssistantPanel";
import { useAiStatus } from "./useAssistant";

/** The top bar's way to the assistant: only when the hub has one this player may use. */
export function AssistantButton({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const status = useAiStatus();
  const [open, setOpen] = useState(false);
  if (!status?.enabled || !status.canUse) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("ai.open")}
        title={t("ai.open")}
        data-testid="open-assistant"
        className="btn btn-ghost btn-icon size-8 shrink-0"
      >
        <Sparkles className="size-4 shrink-0" />
      </button>
      <AssistantPanel projectId={projectId} open={open} onOpenChange={setOpen} />
    </>
  );
}
