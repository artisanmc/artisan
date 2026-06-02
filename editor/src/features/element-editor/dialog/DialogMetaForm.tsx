import type { Dialog, DialogButton, Pack } from "@/domain/types";
import { useTranslation } from "react-i18next";
import { DialogButtonRow } from "./DialogButtonRow";
import { dialogButtonLabelKey } from "@/lib/i18nKeys";

interface Props {
  pack: Pack;
  dialog: Dialog;
  onChange: (next: Dialog) => void;
}

export function DialogMetaForm({ pack, dialog, onChange }: Props) {
  const { t } = useTranslation();

  // Dialog.title is LText { key: I18nKey } — resolve to display string
  const titleText =
    pack.i18nKeys[dialog.title.key]?.[pack.defaultLang] ?? "";

  // Dialog.body is DialogBody[] — extract the first text body part if any.
  // DialogBody text variant: { type: "text", text: LText }
  const firstTextBody = dialog.body.find((b) => b.type === "text");
  const bodyText =
    firstTextBody?.type === "text"
      ? (pack.i18nKeys[firstTextBody.text.key]?.[pack.defaultLang] ?? "")
      : "";

  const buttons: DialogButton[] = dialog.buttons;

  const updateButton = (idx: number, next: DialogButton) => {
    const out = buttons.slice();
    out[idx] = next;
    onChange({ ...dialog, buttons: out });
  };

  const removeButton = (idx: number) => {
    onChange({ ...dialog, buttons: buttons.filter((_, i) => i !== idx) });
  };

  const addButton = () => {
    const newId = `btn_${Math.random().toString(36).slice(2, 8)}`;
    const labelKey = dialogButtonLabelKey(dialog.id, newId);
    onChange({
      ...dialog,
      buttons: [
        ...buttons,
        { id: newId, label: { key: labelKey }, steps: [] } as DialogButton,
      ],
    });
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Title field — V1 stub: renders the resolved i18n value but typing does
          not yet write back to pack.i18nKeys. Use setDialogTitle (accountStore)
          to persist title edits. This is intentional placeholder behaviour for
          V1; proper write-through is a V2 polish item. */}
      <label className="flex flex-col gap-1 text-[12px]">
        <span className="text-[var(--ink-mut)]">{t("dialogMeta.title")}</span>
        <input
          className="input"
          value={titleText}
          onChange={() => onChange({ ...dialog })}
        />
      </label>

      {/* Body field — same V1 stub: renders the first text body's i18n value.
          Use setDialogBodyText (accountStore) to persist body edits. */}
      <label className="flex flex-col gap-1 text-[12px]">
        <span className="text-[var(--ink-mut)]">{t("dialogMeta.body")}</span>
        <textarea
          className="input"
          rows={3}
          value={bodyText}
          onChange={() => onChange({ ...dialog })}
        />
      </label>

      <div className="flex flex-col gap-2">
        <h3 className="eyebrow">{t("dialogMeta.buttons")}</h3>
        {buttons.map((b, i) => (
          <DialogButtonRow
            key={b.id}
            pack={pack}
            button={b}
            onChange={(next) => updateButton(i, next)}
            onRemove={() => removeButton(i)}
          />
        ))}
        <button type="button" className="btn btn-sm" onClick={addButton}>
          {t("dialogMeta.addButton")}
        </button>
      </div>
    </div>
  );
}
