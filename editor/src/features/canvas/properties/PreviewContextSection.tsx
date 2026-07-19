import { Input } from "@/components/ui/input";
import type { ContextInput, Menu, ProjectId } from "@/domain/types";
import { resolveSourceRef } from "@/features/canvas/menuPreviewScope";
import { useAccountStore } from "@/state/accountStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import { useTranslation } from "react-i18next";
import { extractArgTokens } from "./MenuDataSection";

type SourceRefInput = Extract<ContextInput, { kind: "sourceRef" }>;

/**
 * "Preview as…" selector for parameterized menus (e.g. shop_category filtered
 * by `{category_id}`): pick the arg's value from the DISTINCT values the live
 * rows actually hold for the filtered field, and the whole canvas re-renders
 * with that context (buildPreviewScope applies the menu's filter/sort/limit).
 * Free-text fallback when no rows are available to enumerate.
 */
export function PreviewContextSection({ menu, projectId }: { menu: Menu; projectId: ProjectId }) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);
  const menuPreviewArgs = useUiStore((s) => s.menuPreviewArgs);
  const setMenuPreviewArg = useUiStore((s) => s.setMenuPreviewArg);
  if (!pack) return null;
  const previewArgs = menuPreviewArgs[menu.id] ?? {};

  const sourceInputs = (menu.contextInputs ?? []).filter(
    (i): i is SourceRefInput => i.kind === "sourceRef" && !!i.ref,
  );
  // token → candidate values, harvested from the UNFILTERED rows of every
  // source whose filter interpolates that token (field of the filter entry).
  const candidates = new Map<string, Set<string>>();
  for (const input of sourceInputs) {
    const tokens = extractArgTokens(input);
    if (tokens.length === 0) continue;
    const rows = resolveSourceRef(input.ref, pack, snapshots);
    for (const [field, template] of Object.entries(input.filter ?? {})) {
      for (const token of tokens) {
        if (!template.includes(`{${token}}`)) continue;
        const set = candidates.get(token) ?? new Set<string>();
        if (Array.isArray(rows)) {
          for (const r of rows) {
            const v = (r as Record<string, unknown>)?.[field];
            if (v !== undefined && v !== null) set.add(String(v));
          }
        }
        candidates.set(token, set);
      }
    }
  }
  if (candidates.size === 0) return null;

  return (
    <div className="flex flex-col gap-1.5" data-testid="preview-context-section">
      <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
        {t("menuProperties.previewContext")}
      </div>
      <p className="text-[10px] text-[var(--text-faint)]">{t("menuProperties.previewContextHint")}</p>
      {[...candidates.entries()].map(([token, values]) => (
        <label key={token} className="flex items-center gap-1.5 text-[10px] text-[var(--text-mut)]">
          <span className="font-mono">{`{${token}}`}</span>
          {values.size > 0 ? (
            <select
              data-testid={`preview-arg-${token}`}
              className="h-6 flex-1 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-1.5 font-mono text-[10px] text-[var(--text)]"
              value={previewArgs[token] ?? ""}
              onChange={(e) => setMenuPreviewArg(menu.id, token, e.target.value)}
            >
              <option value="">{t("menuProperties.previewContextAll")}</option>
              {[...values].sort().map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <Input
              data-testid={`preview-arg-${token}`}
              value={previewArgs[token] ?? ""}
              onChange={(e) => setMenuPreviewArg(menu.id, token, e.target.value)}
              className="h-6 flex-1 px-2 py-0 font-mono text-[10px]"
            />
          )}
        </label>
      ))}
    </div>
  );
}
