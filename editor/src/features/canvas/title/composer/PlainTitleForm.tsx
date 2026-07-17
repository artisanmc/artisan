import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RevealField } from "@/components/RevealField";
import { usePlaceholderEntries } from "@/components/usePlaceholderEntries";
import type { MenuId, ProjectId } from "@/domain/types";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useTextEdit } from "@/lib/useText";
import { useAccountStore } from "@/state/accountStore";

interface PlainTitleFormProps {
  projectId: ProjectId;
  menuId: MenuId;
}

/**
 * Inline editor for a vanilla (plain) title layer. Shown directly in the
 * LayersPanel when vanilla mode is active — no layer selection needed.
 */
export function PlainTitleForm({ projectId, menuId }: PlainTitleFormProps) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const placeholderLocation = useMemo(
    () => ({ kind: "menu" as const, menuId }),
    [menuId],
  );
  const placeholderEntries = usePlaceholderEntries(projectId, placeholderLocation);

  const plainLayer = menu?.title.find((l) => l.kind === "plain");
  const textEdit = useTextEdit(projectId, plainLayer?.kind === "plain" ? plainLayer.value : { key: "" as import("@/domain/types").I18nKey });

  if (!plainLayer || plainLayer.kind !== "plain") return null;

  return (
    <div className="flex flex-col gap-3 text-xs text-zinc-300">
      <div className="rounded border border-zinc-700 bg-zinc-900/60 px-2.5 py-2 text-[10px] text-zinc-400 leading-snug">
        Titre vanilla — aucun resource pack requis. MiniMessage supporté (
        <code className="text-zinc-300">{"<gold>"}</code>,{" "}
        <code className="text-zinc-300">{"<bold>"}</code>, etc.).
      </div>

      <div>
        <div className="mb-1 block text-[10px] uppercase text-zinc-500">
          Titre (MiniMessage) — {textEdit.lang}
        </div>
        <RevealField
          value={textEdit.value}
          onChange={(v) =>
            setI18nValue({
              projectId,
              lt: plainLayer.value,
              lang: textEdit.lang,
              value: v,
            })
          }
          entries={placeholderEntries}
          placeholder={t("layerEditForm.plainPlaceholder")}
          className="text-xs"
          facade={<MiniMessageInline source={textEdit.value} className="font-mono text-xs" />}
          preview={
            <div className="mt-1 rounded border border-zinc-800 bg-zinc-900/40 p-2">
              <div className="mb-1 text-[10px] uppercase text-zinc-500">Aperçu</div>
              <MiniMessageInline source={textEdit.value} className="font-mono text-xs" />
            </div>
          }
        />
      </div>
    </div>
  );
}
