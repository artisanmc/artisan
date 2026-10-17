import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";
import { MaterialPicker } from "./MaterialPicker";
import { useTextureUrl } from "./textureStore";

/**
 * A material field: a button showing the item's texture, which opens the item palette
 * ({@link MaterialPicker}), next to the name typed by hand. Used by the actions' material
 * arguments and, through the SDK (`MaterialInput`), by module views.
 */
export function MaterialField({
  value,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (material: string) => void;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const { t } = useTranslation();
  const url = useTextureUrl(value);
  return (
    <div className="flex items-center gap-1.5">
      <MaterialPicker
        trigger={
          <button
            type="button"
            title={t("actionEditor.materialPick")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border-soft)] bg-[var(--surface)] hover:border-[var(--brand)]"
          >
            {url ? (
              <img
                src={url}
                alt={value}
                draggable={false}
                className="h-3/4 w-3/4 object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <span className="text-[8px] text-[var(--text-faint)]">
                {value.slice(0, 3) || "—"}
              </span>
            )}
          </button>
        }
        onPick={onChange}
      />
      <Input
        value={value}
        placeholder={placeholder ?? t("actionEditor.materialPlaceholder")}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      />
    </div>
  );
}
