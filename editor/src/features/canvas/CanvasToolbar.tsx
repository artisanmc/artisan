import { useUiStore } from "@/state/uiStore";
import { Hand, MousePointer2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function CanvasToolbar() {
  const { t } = useTranslation();
  const mode = useUiStore((s) => s.canvasMode);
  const setMode = useUiStore((s) => s.setCanvasMode);
  const btn = (active: boolean) =>
    `flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] transition-colors ${
      active
        ? "bg-[var(--brand-soft)] text-[var(--brand)]"
        : "text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
    }`;
  return (
    <div
      className="-translate-x-1/2 absolute bottom-4 left-1/2 z-20 flex items-center gap-1 rounded-[12px] border border-[var(--border)] bg-[var(--surface-raised)]/95 p-1 backdrop-blur"
      style={{ boxShadow: "var(--shadow-md)" }}
    >
      <button
        type="button"
        aria-pressed={mode === "select"}
        aria-keyshortcuts="v"
        title={`${t("canvas.modeSelect")} (V)`}
        onClick={() => setMode("select")}
        className={btn(mode === "select")}
      >
        <MousePointer2 className="size-4" /> {t("canvas.modeSelect")}
      </button>
      <button
        type="button"
        aria-pressed={mode === "hand"}
        aria-keyshortcuts="h"
        title={`${t("canvas.modeHand")} (H)`}
        onClick={() => setMode("hand")}
        className={btn(mode === "hand")}
      >
        <Hand className="size-4" /> {t("canvas.modeHand")}
      </button>
    </div>
  );
}
