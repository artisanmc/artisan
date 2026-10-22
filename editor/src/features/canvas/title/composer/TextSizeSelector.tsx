import { useTranslation } from "react-i18next";

import type { TextSize } from "@/domain/types";

interface TextSizeSelectorProps {
  /** Unique HTML id so the label associates correctly when multiple instances
   *  coexist (e.g. one in TextLayerForm, one in TextareaLayerForm). */
  id: string;
  value: TextSize | undefined;
  /** Receives `undefined` when the user picks the vanilla default (8) — keeps
   *  in-memory state compact, mirroring menuV1FromDomain.ts's default-omit convention. */
  onChange: (size: TextSize | undefined) => void;
}

/**
 * Dropdown for choosing a text layer's bitmap size (vanilla text only — hide
 * this selector when the layer has a custom `fontAssetId`). 6 options: 8
 * (vanilla) and five upscale multiples of 4. Downscale h<8 was dropped
 * because the bitmap PNG isn't authored for it. Default 8.
 */
export function TextSizeSelector({ id, value, onChange }: TextSizeSelectorProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="field-label !mb-0">
        {t("layerEditForm.size.label")}
      </label>
      <select
        id={id}
        value={value ?? 8}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10) as TextSize;
          onChange(n === 8 ? undefined : n);
        }}
        className="h-8 w-full rounded border border-[var(--border)] bg-[var(--surface-raised)] px-2 text-xs text-[var(--text)]"
      >
        <option value={8}>{t("layerEditForm.size.options.normal")}</option>
        <option value={12}>{t("layerEditForm.size.options.s")}</option>
        <option value={16}>{t("layerEditForm.size.options.m")}</option>
        <option value={20}>{t("layerEditForm.size.options.l")}</option>
        <option value={24}>{t("layerEditForm.size.options.xl")}</option>
        <option value={32}>{t("layerEditForm.size.options.xxl")}</option>
      </select>
    </div>
  );
}
