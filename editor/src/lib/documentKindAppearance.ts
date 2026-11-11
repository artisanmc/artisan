import { documentKindContribution } from "@artisan/editor-sdk";
import { FileText, LayoutGrid, MessageSquare, TerminalSquare, Zap } from "lucide-react";
import type { ComponentType } from "react";

type KindIcon = ComponentType<{ className?: string }>;

/**
 * The colour and icon a Document kind wears everywhere outside the board: sidebar,
 * editor header, search, tabs. The core kinds have tokens (`--kind-<kind>` and its
 * `-soft` / `-line`, in globals.css) matching their board node; a module kind takes its
 * `board.accent`, else `--kind-module`.
 */
export interface KindAppearance {
  icon: KindIcon;
  fg: string;
  soft: string;
  line: string;
}

const CORE: Record<string, KindIcon> = {
  menu: LayoutGrid,
  command: TerminalSquare,
  dialog: MessageSquare,
  trigger: Zap,
};

export function kindAppearance(kind: string): KindAppearance {
  const core = CORE[kind];
  if (core) {
    return {
      icon: core,
      fg: `var(--kind-${kind})`,
      soft: `var(--kind-${kind}-soft)`,
      line: `var(--kind-${kind}-line)`,
    };
  }
  const contribution = documentKindContribution(kind);
  const icon: KindIcon = (contribution?.icon as KindIcon | undefined) ?? FileText;
  const accent = contribution?.board?.accent;
  if (accent) {
    return {
      icon,
      fg: accent,
      soft: `color-mix(in srgb, ${accent} 14%, transparent)`,
      line: `color-mix(in srgb, ${accent} 40%, transparent)`,
    };
  }
  return {
    icon,
    fg: "var(--kind-module)",
    soft: "var(--kind-module-soft)",
    line: "var(--kind-module-line)",
  };
}
