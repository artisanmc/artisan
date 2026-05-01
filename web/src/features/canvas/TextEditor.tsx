import type { MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useEditingStore } from "@/state/editingStore";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TEX_FIRST_SLOT_X, TEX_SCALE, menuBoxSize } from "./menuLayout";
import type { ViewportState } from "./usePanZoom";

interface TextEditorProps {
  packId: PackId;
  layout: Record<string, { x: number; y: number }>;
  viewport: ViewportState;
}

/**
 * Inline editor for the active menu's title. Renders an absolutely-positioned
 * <input> on top of the Konva canvas, positioned over the title bar (mapped
 * to the same x/y the Konva Text uses on the texture). Re-positioned on
 * every viewport change because Stage re-renders us on viewport state updates.
 *
 * Commit: blur or Enter → setMenuField. Cancel: Escape.
 */
export function TextEditor({ packId, layout, viewport }: TextEditorProps) {
  const editingMenuId = useEditingStore((s) => s.editingMenuId);
  const setEditing = useEditingStore((s) => s.setEditing);
  const setMenuField = useAccountStore((s) => s.setMenuField);
  const menu = useAccountStore((s) =>
    editingMenuId
      ? s.account.packs.find((p) => p.id === packId)?.menus.find((m) => m.id === editingMenuId)
      : undefined,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: open the editor when menu becomes available
  useEffect(() => {
    if (menu) {
      setDraft(menu.title);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [menu?.id]);

  if (!menu) return null;
  const pos = layout[menu.id];
  if (!pos) return null;

  const box = menuBoxSize(menu.rows);
  // Title sits in the texture's title bar — same x as the Konva Text in MenuGroup.
  const titleOffsetX = TEX_FIRST_SLOT_X + 1;
  const titleOffsetY = 5 * TEX_SCALE;
  const screenX = (pos.x + titleOffsetX) * viewport.scale + viewport.x;
  const screenY = (pos.y + titleOffsetY) * viewport.scale + viewport.y;
  const screenW = (box.width - titleOffsetX * 2) * viewport.scale;

  const commit = () => {
    if (!editingMenuId) return;
    const trimmed = draft.trim();
    if (trimmed && trimmed !== menu.title) {
      try {
        setMenuField({ packId, menuId: editingMenuId as MenuId, field: "title", value: trimmed });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "title edit failed");
      }
    }
    setEditing(null);
  };

  const cancel = () => setEditing(null);

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") cancel();
        e.stopPropagation();
      }}
      style={{
        position: "absolute",
        left: screenX,
        top: screenY,
        width: screenW,
        height: 9 * TEX_SCALE * viewport.scale,
        padding: 0,
        border: 0,
        outline: "1px solid #22c55e",
        background: "rgba(198,198,198,0.95)",
        color: "#404040",
        fontFamily: "ui-monospace, monospace",
        fontSize: 7 * TEX_SCALE * viewport.scale,
      }}
    />
  );
}
