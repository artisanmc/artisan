import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ArrangeMode } from "@/features/canvas/arrangeBoard";
import { type CanvasKind, useUiStore } from "@/state/uiStore";
import {
  Check,
  ChevronDown,
  Hand,
  LayoutGrid,
  MessageSquare,
  MousePointer2,
  TerminalSquare,
  WandSparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";

const ARRANGE_MODES: ArrangeMode[] = ["columns", "cluster", "force", "structured"];

/** Filtres par type : un type écarté est atténué sur la planche, jamais retiré. */
const KIND_FILTERS: { kind: CanvasKind; label: string; Icon: typeof LayoutGrid }[] = [
  { kind: "menu", label: "projectPanel.menus", Icon: LayoutGrid },
  { kind: "command", label: "projectPanel.commands", Icon: TerminalSquare },
  { kind: "dialog", label: "projectPanel.dialogs", Icon: MessageSquare },
];

export function CanvasToolbar({
  onRearrange,
  rearrangeDisabled = false,
}: {
  /** Absent en vue focus : il n'y a qu'un Document, rien à arranger. */
  onRearrange?: (mode: ArrangeMode) => void;
  rearrangeDisabled?: boolean;
} = {}) {
  const { t } = useTranslation();
  const mode = useUiStore((s) => s.canvasMode);
  const setMode = useUiStore((s) => s.setCanvasMode);
  const arrangeMode = useUiStore((s) => s.arrangeMode);
  const setArrangeMode = useUiStore((s) => s.setArrangeMode);
  const hiddenKinds = useUiStore((s) => s.canvasHiddenKinds);
  const toggleKind = useUiStore((s) => s.toggleCanvasKind);
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
      {onRearrange && (
        <>
          <span className="mx-0.5 h-5 w-px bg-[var(--border)]" />
          {KIND_FILTERS.map(({ kind, label, Icon }) => {
            const shown = !hiddenKinds.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={shown}
                aria-label={t(label)}
                title={t(shown ? "canvas.filterDim" : "canvas.filterShow", { kind: t(label) })}
                onClick={() => toggleKind(kind)}
                className={`${btn(false)} px-2 ${shown ? "" : "opacity-40"}`}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
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
