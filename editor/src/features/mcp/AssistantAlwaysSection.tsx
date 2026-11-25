import { Button } from "@/components/ui/button";
import { getAiPermissions, revokeAiPermission } from "@/lib/api/ai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * What the player answered "always" to when the editor's assistant asked before a tool the
 * server's owner pays for (`generate_image`), each one taken back here: the assistant then asks
 * again. Nothing shows while there is none, or without an assistant.
 */
export function AssistantAlwaysSection() {
  const { t } = useTranslation();
  const [always, setAlways] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getAiPermissions()
      .then(setAlways)
      .catch(() => setAlways([]));
  }, []);

  if (always.length === 0) return null;
  const name = (tool: string) => t(`ai.permission.tools.${tool}`, { defaultValue: tool });
  const revoke = async () => {
    setFailed(false);
    try {
      let left = always;
      for (const tool of always) left = await revokeAiPermission(tool);
      setAlways(left);
    } catch {
      setFailed(true);
    }
  };

  return (
    <section className="flex flex-col gap-2" data-testid="assistant-always">
      <div className="card flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[14px] font-semibold text-[var(--text)]">
            {t("mcp.apps.assistant")}
          </span>
          <span className="text-[12px] text-[var(--text-mut)]">
            {t("mcp.apps.assistantAlways", { tools: always.map(name).join(", ") })}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => void revoke()}>
          {t("mcp.apps.assistantRevoke")}
        </Button>
      </div>
      {failed && <p className="text-[13px] text-[var(--danger)]">{t("mcp.apps.failed")}</p>}
    </section>
  );
}
