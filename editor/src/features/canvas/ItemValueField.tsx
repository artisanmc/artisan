import { Input } from "@/components/ui/input";
import { readAdvanced, writeAdvanced } from "@/domain/itemAdvanced";
import type { ProjectId } from "@/domain/types";
import { AdvancedItemSection } from "@/features/flow/AdvancedItemSection";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { MaterialRefField } from "./MaterialRefField";

export function ItemValueField({
  projectId,
  value,
  onChange,
}: {
  projectId: ProjectId;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const countId = useId();
  const item: Record<string, unknown> =
    typeof value === "string"
      ? { material: value }
      : value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : { material: "" };
  const material = typeof item.material === "string" ? item.material : "";
  const advanced = readAdvanced(item);
  if (Array.isArray(item.enchants)) {
    advanced.enchants = item.enchants.filter(
      (entry): entry is { id: string; level: number } =>
        entry && typeof entry.id === "string" && typeof entry.level === "number",
    );
  }
  return (
    <div className="flex min-w-56 flex-col gap-2">
      <MaterialRefField
        projectId={projectId}
        value={material}
        onChange={(next) =>
          onChange(typeof value === "string" ? next : { ...item, material: next })
        }
      />
      <label htmlFor={countId} className="flex items-center gap-2 text-xs">
        {t("flow.countLabel")}
        <Input
          id={countId}
          type="number"
          min={1}
          max={64}
          step={1}
          aria-label={t("flow.countLabel")}
          value={typeof item.count === "number" ? item.count : ""}
          placeholder="1"
          className="h-7 w-20"
          onChange={(e) => {
            const next = Object.fromEntries(
              Object.entries(item).filter(([key]) => key !== "count"),
            );
            if (e.target.value !== "")
              next.count = Math.max(1, Math.min(64, Math.floor(Number(e.target.value))));
            onChange(next);
          }}
        />
      </label>
      <AdvancedItemSection
        appearance={advanced}
        material={material}
        onChange={(patch) => {
          const next = { ...item };
          for (const key of [
            "enchants",
            "enchanted",
            "custom_model_data",
            "unbreakable",
            "hide",
            "color",
            "nbt",
          ])
            delete next[key];
          const merged = { ...advanced, ...patch };
          writeAdvanced(merged, next);
          if (merged.enchants?.some((e) => !e.id.trim())) next.enchants = merged.enchants;
          onChange(next);
        }}
      />
    </div>
  );
}
