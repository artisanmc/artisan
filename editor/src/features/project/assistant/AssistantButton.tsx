import { useAssistantPanelStore } from "@/state/assistantPanelStore";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiStatus } from "./useAssistant";

/** The top bar's way to the assistant dock: only when the hub has one this player may use. */
export function AssistantButton() {
  const { t } = useTranslation();
  const status = useAiStatus();
  const { open, toggle } = useAssistantPanelStore();
  if (!status?.enabled || !status.canUse) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t("ai.open")}
      aria-pressed={open}
      title={t("ai.open")}
      data-testid="open-assistant"
      className={`btn btn-ghost btn-icon size-8 shrink-0 ${open ? "text-[var(--brand)]" : ""}`}
    >
      <Sparkles className="size-4 shrink-0" />
    </button>
  );
}
