import type { MenuId, PackId } from "@/domain/types";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useTextEdit } from "@/lib/useText";
import { useAccountStore } from "@/state/accountStore";

interface PlainTitleFormProps {
  packId: PackId;
  menuId: MenuId;
}

/**
 * Inline editor for a vanilla (plain) title layer. Shown directly in the
 * LayersPanel when vanilla mode is active — no layer selection needed.
 */
export function PlainTitleForm({ packId, menuId }: PlainTitleFormProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);

  const plainLayer = menu?.title.find((l) => l.kind === "plain");
  const textEdit = useTextEdit(packId, plainLayer?.kind === "plain" ? plainLayer.value : { key: "" as import("@/domain/types").I18nKey });

  if (!plainLayer || plainLayer.kind !== "plain") return null;

  return (
    <div className="flex flex-col gap-3 text-xs text-zinc-300">
      <div className="rounded border border-zinc-700 bg-zinc-900/60 px-2.5 py-2 text-[10px] text-zinc-400 leading-snug">
        Titre vanilla — aucun resource pack requis. MiniMessage supporté (
        <code className="text-zinc-300">{"<gold>"}</code>,{" "}
        <code className="text-zinc-300">{"<bold>"}</code>, etc.).
      </div>

      <div>
        <label
          htmlFor="plain-title-text"
          className="mb-1 block text-[10px] uppercase text-zinc-500"
        >
          Texte (MiniMessage) — {textEdit.lang}
        </label>
        <textarea
          id="plain-title-text"
          value={textEdit.value}
          onChange={(e) =>
            setI18nValue({
              packId,
              lt: plainLayer.value,
              lang: textEdit.lang,
              value: e.target.value,
            })
          }
          className="min-h-[60px] w-full resize-y rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
          placeholder="Texte du titre…"
        />
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
        <div className="mb-1 text-[10px] uppercase text-zinc-500">Aperçu</div>
        <MiniMessageInline source={textEdit.value} className="font-mono text-xs" />
      </div>
    </div>
  );
}
