import type { AssetUsage } from "@/domain/asset";
import { ASSET_USAGES } from "@/domain/assetUsage";
import { useTranslation } from "react-i18next";

export function AssetUsageFields({
  value,
  onChange,
  requiredUsage,
}: { value: AssetUsage[]; onChange: (value: AssetUsage[]) => void; requiredUsage?: AssetUsage }) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="field-label mb-1">{t("resources.usages")}</legend>
      {ASSET_USAGES.map((usage) => (
        <label key={usage} className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="accent-[var(--brand)]"
            checked={value.includes(usage)}
            disabled={requiredUsage === usage}
            onChange={(event) =>
              onChange(
                ASSET_USAGES.filter(
                  (entry) =>
                    entry === requiredUsage ||
                    (entry === usage ? event.target.checked : value.includes(entry)),
                ),
              )
            }
          />
          {t(`resources.${usage}`)}
        </label>
      ))}
      <p className="text-xs text-[var(--text-mut)]">{t("resources.usageHint")}</p>
    </fieldset>
  );
}
