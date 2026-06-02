import type { DialogButton, Pack } from "@/domain/types";
import { useTranslation } from "react-i18next";
import { ActionsChainEditor } from "../actions/ActionsChainEditor";
import { AddActionButton } from "../actions/AddActionButton";
import type { Step } from "@/domain/types";

interface Props {
  pack: Pack;
  button: DialogButton;
  onChange: (next: DialogButton) => void;
  onRemove: () => void;
}

export function DialogButtonRow({ pack, button, onChange, onRemove }: Props) {
  const { t } = useTranslation();

  // DialogButton.label is LText { key: I18nKey }
  const labelText =
    pack.i18nKeys[button.label.key]?.[pack.defaultLang] ?? "";

  // DialogButton.steps: Step[] — the field is named "steps" (same as Command)
  const steps: Step[] = button.steps;

  return (
    <div className="rounded-[8px] border border-[var(--line-soft)] p-3">
      <div className="flex items-center justify-between gap-2">
        <label className="flex flex-1 flex-col gap-1 text-[12px]">
          <span className="text-[var(--ink-mut)]">
            {t("dialogMeta.buttonLabel")}
          </span>
          <input
            className="input"
            value={labelText}
            onChange={() => {
              // V1: label edits are propagated through pack.i18nKeys externally
              // (via setDialogButtonLabel in accountStore). DialogButtonRow only
              // re-emits the button object unchanged to trigger the parent's
              // onChange so the store knows something changed. Write-through for
              // the label text is a V2 polish item.
              onChange({ ...button });
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          onClick={onRemove}
          aria-label="Remove button"
        >
          ×
        </button>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <h4 className="eyebrow">{t("dialogMeta.buttonActions")}</h4>
        <ActionsChainEditor
          steps={steps}
          packMenus={pack.menus}
          onChange={(nextSteps) => onChange({ ...button, steps: nextSteps })}
        />
        <AddActionButton
          onAdd={(step) =>
            onChange({ ...button, steps: [...steps, step] })
          }
        />
      </div>
    </div>
  );
}
