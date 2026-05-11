import type { PackId, MenuId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";

interface TitleThumbnailProps {
  packId: PackId;
  menuId: MenuId;
}

export function TitleThumbnail({ packId, menuId }: TitleThumbnailProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const activeLang = useUiStore((s) => s.activeLang);
  if (!pack || !menu) return null;

  if (menu.title.length === 0) {
    return (
      <div className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 text-[11px] text-zinc-500">
        No title
      </div>
    );
  }

  const firstText = menu.title.find((l) => l.kind === "text");
  const text =
    firstText && firstText.kind === "text"
      ? getText(pack, firstText.value, activeLang)
      : "";

  return (
    <div className="flex items-center gap-2 rounded border border-zinc-800 bg-[#3f3f3f] px-2 py-1.5">
      {text ? (
        <MiniMessageInline source={text} className="font-mono text-xs text-zinc-200" />
      ) : (
        <span className="font-mono text-xs text-zinc-500">(no text)</span>
      )}
      {menu.title.length > 1 && (
        <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400">
          {menu.title.length} layers
        </span>
      )}
    </div>
  );
}
