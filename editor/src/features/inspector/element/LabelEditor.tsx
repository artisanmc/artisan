import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Appearance } from "@/domain/types";
import { TextSizeSelector } from "@/features/canvas/title/composer/TextSizeSelector";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";

type Label = NonNullable<Appearance["label"]>;
export type LabelPlacement = Partial<Omit<Label, "text">>;

/**
 * The label of an appearance: a text drawn in the title over the element's slots.
 * [text] is the localized text field (its editor comes from the card); the placement
 * fields only show once a label exists.
 */
export function LabelEditor({
  label,
  text,
  onPlacement,
  onRemove,
}: {
  label?: Label;
  text: ReactNode;
  onPlacement: (patch: LabelPlacement) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      {text}
      {label && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="field-label" htmlFor={`${id}-align`}>
              {t("elementLabel.align")}
              <select
                id={`${id}-align`}
                className="input w-full"
                value={label.align ?? "center"}
                onChange={(event) => {
                  const align = event.target.value as Label["align"];
                  onPlacement({ align: align === "center" ? undefined : align });
                }}
              >
                <option value="left">{t("elementLabel.left")}</option>
                <option value="center">{t("elementLabel.center")}</option>
                <option value="right">{t("elementLabel.right")}</option>
              </select>
            </label>
            <TextSizeSelector
              id={`${id}-size`}
              value={label.size}
              onChange={(size) => onPlacement({ size })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["offset_x", "offset_y"] as const).map((axis) => (
              <label key={axis} className="field-label" htmlFor={`${id}-${axis}`}>
                {t(axis === "offset_x" ? "imageButton.offsetX" : "imageButton.offsetY")}
                <Input
                  id={`${id}-${axis}`}
                  type="number"
                  step={1}
                  min={-256}
                  max={256}
                  value={label[axis] ?? 0}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isInteger(value) && Math.abs(value) <= 256)
                      onPlacement({ [axis]: value === 0 ? undefined : value });
                  }}
                />
              </label>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={onRemove}>
            {t("elementLabel.remove")}
          </Button>
        </>
      )}
    </div>
  );
}
