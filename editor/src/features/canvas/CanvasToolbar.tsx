import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ArrangeMode } from "@/features/canvas/arrangeBoard";
import { useUiStore } from "@/state/uiStore";
import { Check, ChevronDown, Hand, MousePointer2, WandSparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

const ARRANGE_MODES: ArrangeMode[] = ["columns", "cluster", "force", "structured"];

export function CanvasToolbar({
  onRearrange,
  rearrangeDisabled = false,
  variants,
}: {
  /** "View as": the variant switcher of the project, on the board only. */
  variants?: React.ReactNode;
  /** Absent in focus view: there is only one Document, nothing to arrange. */
  onRearrange?: (mode: ArrangeMode) => void;
  rearrangeDisabled?: boolean;
} = {}) {
  const { t } = useTranslation();
  const mode = useUiStore((s) => s.canvasMode);
  const setMode = useUiStore((s) => s.setCanvasMode);
  const arrangeMode = useUiStore((s) => s.arrangeMode);
  const setArrangeMode = useUiStore((s) => s.setArrangeMode);
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
      {variants && (
        <>
          <span className="mx-0.5 h-5 w-px bg-[var(--border)]" />
          {variants}
        </>
      )}
      {onRearrange && (
        <>
          <span className="mx-0.5 h-5 w-px bg-[var(--border)]" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={rearrangeDisabled}
                title={t(rearrangeDisabled ? "canvas.rearrangeNothing" : "canvas.rearrangeHint")}
                className={`${btn(false)} disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent`}
              >
                <WandSparkles className="size-4" /> {t("canvas.rearrange")}
                <ChevronDown className="size-3.5 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" side="top" className="w-64">
              <DropdownMenuLabel>{t("canvas.arrangeModes.label")}</DropdownMenuLabel>
              {ARRANGE_MODES.map((m) => (
                <DropdownMenuItem
                  key={m}
                  onSelect={() => {
                    setArrangeMode(m);
                    onRearrange(m);
                  }}
                  className="flex-col items-start gap-0.5"
                >
                  <span className="flex items-center gap-1.5 text-[var(--text)]">
                    {m === arrangeMode ? (
                      <Check className="size-3.5 text-[var(--brand)]" />
                    ) : (
                      <span className="size-3.5" />
                    )}
                    {t(`canvas.arrangeModes.${m}`)}
                  </span>
                  <span className="pl-5 text-[11px] text-[var(--text-mut)]">
                    {t(`canvas.arrangeModes.${m}Hint`)}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
}
