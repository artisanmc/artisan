import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type ModelsResponse,
  type PublicAiModelDto,
  getModels,
  setPreferredModel,
} from "@/lib/api/aiUser";
import { cn } from "@/lib/cx";
import { formatCredits } from "@/lib/format";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const BADGE_VARIANT: Record<PublicAiModelDto["badge"], "sage" | "amber" | "terra"> = {
  cheap: "sage",
  balanced: "amber",
  premium: "terra",
};

/**
 * ModelSelector — dropdown picker for the assistant's LLM model, shown in the
 * AssistantChat composer. Loads the active model catalog on mount, preselects
 * the user's preferred model (falling back to the provider default), and
 * persists the choice server-side on every pick.
 */
export function ModelSelector({
  token,
  value,
  onChange,
  onModelsLoaded,
  className,
}: {
  token: string | null;
  value: string | null;
  onChange: (id: string) => void;
  onModelsLoaded?: (r: ModelsResponse) => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const [models, setModels] = useState<PublicAiModelDto[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: onModelsLoaded is a mount-time callback, not a reactive dep.
  useEffect(() => {
    let cancelled = false;
    getModels(token)
      .then((r) => {
        if (cancelled || !r) return;
        setModels(r.models);
        onModelsLoaded?.(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);

  const current = models.find((m) => m.id === value) ?? null;

  function pick(id: string) {
    onChange(id);
    void setPreferredModel(token, id).catch(() => {});
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title={t("assistant.model.pick")} className={cn("chip", className)}>
          <span>{current?.displayName ?? t("assistant.model.label")}</span>
          {current && (
            <Badge variant={BADGE_VARIANT[current.badge]}>
              {t(`assistant.model.badge.${current.badge}`)}
            </Badge>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={pick}>
          {models.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id} className="flex-col items-start gap-1">
              <div className="flex w-full items-center gap-2">
                <span className="font-medium">{m.displayName}</span>
                <Badge variant={BADGE_VARIANT[m.badge]}>
                  {t(`assistant.model.badge.${m.badge}`)}
                </Badge>
              </div>
              <div className="text-[11px] text-[var(--text-faint)]">{m.description}</div>
              <div className="text-[11px] text-[var(--text-faint)]">
                {t("assistant.model.estChat", {
                  n: formatCredits(m.estimates.chatMessage, i18n.language),
                })}
              </div>
              <div className="text-[11px] text-[var(--text-faint)]">
                {t("assistant.model.estMigration", {
                  n: formatCredits(m.estimates.menuMigration, i18n.language),
                })}
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
