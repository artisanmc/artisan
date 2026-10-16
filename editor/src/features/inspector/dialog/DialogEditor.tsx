import { ServerPlaceholderInput as PlaceholderInput } from "@/components/ServerPlaceholderInput";
import { Input } from "@/components/ui/input";
import { usePlaceholderEntries } from "@/components/usePlaceholderEntries";
import type { Dialog, DialogId, DialogInput, ProjectId } from "@/domain/types";
import { useGetText } from "@/lib/useText";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionChainEditor } from "../chain/StepTree";
import { FieldLabel, Lane } from "../layout";

function DialogIdField({ projectId, dialogId }: { projectId: ProjectId; dialogId: DialogId }) {
  const { t } = useTranslation();
  const setDialogId = useAccountStore((s) => s.setDialogId);
  const [draft, setDraft] = useState(dialogId as string);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(dialogId);
    setError(null);
  }, [dialogId]);

  const commit = () => {
    if (draft === dialogId) return;
    try {
      setDialogId({ projectId, oldId: dialogId, newId: draft as DialogId });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("dialog.renameRejected"));
      setDraft(dialogId);
    }
  };

  return (
    <div className="mb-3">
      <FieldLabel>{t("flow.elementId")}</FieldLabel>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(dialogId);
            setError(null);
            e.currentTarget.blur();
          }
        }}
        className={
          error
            ? "h-8 border-[var(--danger)] px-2 py-0 font-mono text-xs"
            : "h-8 px-2 py-0 font-mono text-xs"
        }
      />
      {error ? <div className="mt-1 text-[10px] text-[var(--danger)]">{error}</div> : null}
    </div>
  );
}

export function DialogEditor({ projectId, dialog }: { projectId: ProjectId; dialog: Dialog }) {
  const { t } = useTranslation();
  const setDialogTitle = useAccountStore((s) => s.setDialogTitle);
  const setDialogField = useAccountStore((s) => s.setDialogField);
  const addDialogBody = useAccountStore((s) => s.addDialogBody);
  const removeDialogBody = useAccountStore((s) => s.removeDialogBody);
  const setDialogBodyText = useAccountStore((s) => s.setDialogBodyText);
  const setDialogBodyMaterial = useAccountStore((s) => s.setDialogBodyMaterial);
  const addDialogInput = useAccountStore((s) => s.addDialogInput);
  const removeDialogInput = useAccountStore((s) => s.removeDialogInput);
  const setDialogInput = useAccountStore((s) => s.setDialogInput);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const addDialogButton = useAccountStore((s) => s.addDialogButton);
  const removeDialogButton = useAccountStore((s) => s.removeDialogButton);
  const setDialogButtonLabel = useAccountStore((s) => s.setDialogButtonLabel);
  const activeLang = useUiStore((s) => s.activeLang);
  const getText = useGetText(projectId);

  const titlePlaceholderLocation = useMemo(
    () => ({ kind: "dialog" as const, dialogId: dialog.id }),
    [dialog.id],
  );
  const titlePlaceholderEntries = usePlaceholderEntries(projectId, titlePlaceholderLocation);

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <div className="border-[var(--border-soft)] border-b bg-[var(--surface-raised)] px-3 py-2">
        <div className="font-mono text-xs text-[var(--brand)]">{dialog.id}</div>
        <div className="text-[10px] text-[var(--text-faint)]">
          dialog · {dialog.buttons.length} button{dialog.buttons.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3">
        <Lane label={t("flow.propertiesLabel")}>
          <DialogIdField projectId={projectId} dialogId={dialog.id} />
          <div>
            <div className="mb-1 text-[10px] uppercase text-[var(--text-faint)]">
              {t("dialog.titleLabel", { lang: activeLang })}
            </div>
            <PlaceholderInput
              value={getText(dialog.title)}
              onChange={(v) =>
                setDialogTitle({ projectId, dialogId: dialog.id, lang: activeLang, value: v })
              }
              entries={titlePlaceholderEntries}
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-mut)]">
              <input
                type="checkbox"
                checked={dialog.canCloseWithEscape}
                onChange={(e) =>
                  setDialogField({
                    projectId,
                    dialogId: dialog.id,
                    field: "canCloseWithEscape",
                    value: e.target.checked,
                  })
                }
                className="h-3.5 w-3.5 accent-[var(--brand)]"
              />
              {t("dialog.canCloseWithEscape")}
            </label>
          </div>
        </Lane>

        <Lane label={t("dialog.bodyLabel")}>
          <div className="flex flex-col gap-2">
            {dialog.body.map((body, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: body index stable per render
                key={i}
                className="flex items-start gap-1.5 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5"
              >
                {body.type === "text" ? (
                  <div className="flex-1">
                    <FieldLabel>text ({activeLang})</FieldLabel>
                    <Input
                      value={getText(body.text)}
                      placeholder={t("dialog.bodyTextPlaceholder")}
                      onChange={(e) =>
                        setDialogBodyText({
                          projectId,
                          dialogId: dialog.id,
                          index: i,
                          lang: activeLang,
                          value: e.target.value,
                        })
                      }
                      className="h-8 px-2 py-0 text-xs"
                    />
                  </div>
                ) : (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      value={body.material}
                      placeholder="DIAMOND"
                      onChange={(e) =>
                        setDialogBodyMaterial({
                          projectId,
                          dialogId: dialog.id,
                          index: i,
                          material: e.target.value,
                          count: body.count,
                        })
                      }
                      className="h-8 flex-1 px-2 py-0 font-mono text-xs"
                    />
                    <Input
                      type="number"
                      min={1}
                      max={64}
                      value={body.count}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isNaN(n) && n >= 1 && n <= 64) {
                          setDialogBodyMaterial({
                            projectId,
                            dialogId: dialog.id,
                            index: i,
                            material: body.material,
                            count: n,
                          });
                        }
                      }}
                      className="h-8 w-16 px-2 py-0 text-xs"
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeDialogBody({ projectId, dialogId: dialog.id, index: i })}
                  className="flex h-7 w-7 items-center justify-center rounded text-[14px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() =>
                  addDialogBody({
                    projectId,
                    dialogId: dialog.id,
                    body: { type: "text", text: { key: "" as Dialog["title"]["key"] } },
                  })
                }
                className="rounded border border-[var(--border)] border-dashed px-2 py-1 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
              >
                {t("dialog.addBodyText")}
              </button>
              <button
                type="button"
                onClick={() =>
                  addDialogBody({
                    projectId,
                    dialogId: dialog.id,
                    body: { type: "item", material: "DIAMOND", count: 1 },
                  })
                }
                className="rounded border border-[var(--border)] border-dashed px-2 py-1 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
              >
                {t("dialog.addBodyItem")}
              </button>
            </div>
          </div>
        </Lane>

        <Lane label={t("dialog.inputsLabel")}>
          <div className="flex flex-col gap-2">
            {dialog.inputs.map((input, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: input index stable per render
                key={i}
                className="flex flex-col gap-1.5 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-[var(--surface-raised-2)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--text-mut)]">
                    {input.type}
                  </span>
                  <Input
                    value={input.id}
                    placeholder={t("dialog.inputIdPlaceholder")}
                    onChange={(e) =>
                      setDialogInput({
                        projectId,
                        dialogId: dialog.id,
                        index: i,
                        patch: { id: e.target.value } as Partial<DialogInput>,
                      })
                    }
                    className="h-7 w-28 px-2 py-0 font-mono text-xs"
                  />
                  <Input
                    value={getText(input.label)}
                    placeholder={t("dialog.inputLabelPlaceholder")}
                    onChange={(e) =>
                      setI18nValue({
                        projectId,
                        lt: input.label,
                        lang: activeLang,
                        value: e.target.value,
                      })
                    }
                    className="h-7 flex-1 px-2 py-0 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => removeDialogInput({ projectId, dialogId: dialog.id, index: i })}
                    className="flex h-7 w-7 items-center justify-center rounded text-[14px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                  >
                    ×
                  </button>
                </div>
                {input.type === "number_range" ? (
                  <div className="flex items-center gap-2 pl-0.5">
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">
                      {t("dialog.inputMin")}
                    </span>
                    <Input
                      type="number"
                      value={input.min}
                      onChange={(e) =>
                        setDialogInput({
                          projectId,
                          dialogId: dialog.id,
                          index: i,
                          patch: { min: Number(e.target.value) } as Partial<DialogInput>,
                        })
                      }
                      className="h-7 w-20 px-2 py-0 text-xs"
                    />
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">
                      {t("dialog.inputMax")}
                    </span>
                    <Input
                      type="number"
                      value={input.max}
                      onChange={(e) =>
                        setDialogInput({
                          projectId,
                          dialogId: dialog.id,
                          index: i,
                          patch: { max: Number(e.target.value) } as Partial<DialogInput>,
                        })
                      }
                      className="h-7 w-20 px-2 py-0 text-xs"
                    />
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">
                      {t("dialog.inputDefault")}
                    </span>
                    <Input
                      type="number"
                      value={input.default}
                      onChange={(e) =>
                        setDialogInput({
                          projectId,
                          dialogId: dialog.id,
                          index: i,
                          patch: { default: Number(e.target.value) } as Partial<DialogInput>,
                        })
                      }
                      className="h-7 w-20 px-2 py-0 text-xs"
                    />
                  </div>
                ) : null}
                {input.type === "text" ? (
                  <div className="flex items-center gap-2 pl-0.5">
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">
                      {t("dialog.inputMaxLength")}
                    </span>
                    <Input
                      type="number"
                      min={1}
                      max={256}
                      value={input.maxLength}
                      onChange={(e) =>
                        setDialogInput({
                          projectId,
                          dialogId: dialog.id,
                          index: i,
                          patch: { maxLength: Number(e.target.value) } as Partial<DialogInput>,
                        })
                      }
                      className="h-7 w-20 px-2 py-0 text-xs"
                    />
                  </div>
                ) : null}
                {input.type === "bool" ? (
                  <div className="flex items-center gap-2 pl-0.5">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--text-mut)]">
                      <input
                        type="checkbox"
                        checked={input.default}
                        onChange={(e) =>
                          setDialogInput({
                            projectId,
                            dialogId: dialog.id,
                            index: i,
                            patch: { default: e.target.checked } as Partial<DialogInput>,
                          })
                        }
                        className="h-3.5 w-3.5 accent-[var(--brand)]"
                      />
                      {t("dialog.inputDefaultChecked")}
                    </label>
                  </div>
                ) : null}
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {(["text", "bool", "number_range"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() =>
                    addDialogInput({ projectId, dialogId: dialog.id, inputType: type })
                  }
                  className="rounded border border-[var(--border)] border-dashed px-2 py-1 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
                >
                  + {type}
                </button>
              ))}
            </div>
          </div>
        </Lane>

        <Lane label={t("dialog.buttonsLabel")}>
          <div className="flex flex-col gap-3">
            {dialog.buttons.map((btn, btnIndex) => (
              <div
                key={btn.id}
                className="rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-2"
              >
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-[var(--text-faint)]">{btn.id}</span>
                  <Input
                    value={getText(btn.label)}
                    placeholder={t("dialog.buttonLabelPlaceholder")}
                    onChange={(e) =>
                      setDialogButtonLabel({
                        projectId,
                        dialogId: dialog.id,
                        buttonIndex: btnIndex,
                        lang: activeLang,
                        value: e.target.value,
                      })
                    }
                    className="h-7 flex-1 px-2 py-0 text-xs"
                  />
                  {dialog.buttons.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        removeDialogButton({
                          projectId,
                          dialogId: dialog.id,
                          buttonIndex: btnIndex,
                        })
                      }
                      className="flex h-7 w-7 items-center justify-center rounded text-[14px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                <div className="overflow-x-auto rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-2">
                  <div className="font-mono text-[12px]">
                    <ActionChainEditor
                      projectId={projectId}
                      address={{ kind: "dialogButton", dialogId: dialog.id, buttonIndex: btnIndex }}
                      steps={btn.steps}
                    />
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addDialogButton({ projectId, dialogId: dialog.id })}
              className="self-start rounded border border-[var(--border)] border-dashed px-3 py-1.5 text-xs text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
            >
              {t("dialog.addButton")}
            </button>
          </div>
        </Lane>
      </div>
    </div>
  );
}
