import { PlayerNameInput } from "@/components/PlayerNameInput";
import { Input } from "@/components/ui/input";
import type { ContextInput, Menu, ProjectId } from "@/domain/types";
import { resolveSourceRef } from "@/features/canvas/menuPreviewScope";
import { findPreviewCallContexts } from "@/features/canvas/previewCallContexts";
import { useAccountStore } from "@/state/accountStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import { useId, useState } from "react";
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
  const fieldId = useId();
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);
  const menuPreviewArgs = useUiStore((s) => s.menuPreviewArgs);
  const setMenuPreviewArg = useUiStore((s) => s.setMenuPreviewArg);
  const setMenuPreviewArgs = useUiStore((s) => s.setMenuPreviewArgs);
  const activeLang = useUiStore((s) => s.activeLang);
  const previewPlayer = useUiStore((s) => s.previewPlayer);
  const [playerDraft, setPlayerDraft] = useState(previewPlayer);
  const setPreviewPlayer = useUiStore((s) => s.setPreviewPlayer);
  if (!project) return null;
  const previewArgs = menuPreviewArgs[menu.id] ?? {};

  // The richest option: real call sites. Each candidate carries EVERY context
  // arg interpolated from ONE caller row (category_id AND category_name
  // together) — the menu itself only declares how args are used, never where
  // their values come from; only callers know that.
  const callContexts = findPreviewCallContexts(menu, project, snapshots, activeLang);
  const selectedCallIdx = callContexts.findIndex((c) =>
    Object.entries(c.args).every(
      ([k, v]) => JSON.stringify(previewArgs[k] ?? "") === JSON.stringify(v),
    ),
  );
  const applyCallContext = (idx: number) => {
    const c = callContexts[idx];
    if (!c) return;
    setMenuPreviewArgs(menu.id, c.args);
  };

  const sourceInputs = (menu.contextInputs ?? []).filter(
    (i): i is SourceRefInput => i.kind === "sourceRef" && !!i.ref,
  );
  // token → candidate values, harvested from the UNFILTERED rows of every
  // source whose filter interpolates that token (field of the filter entry).
  const candidates = new Map<string, Set<string>>();
  for (const input of sourceInputs) {
    const tokens = extractArgTokens(input);
    if (tokens.length === 0) continue;
    const rows = resolveSourceRef(input.ref, project, snapshots);
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
  // Row-model inputs (type object + rowOf): preview candidates are simply the
  // source's rows — pick one, the whole row lands in the preview scope.
  const rowInputs = (menu.contextInputs ?? []).filter(
    (i): i is Extract<ContextInput, { kind: "primitive" }> =>
      i.kind === "primitive" && i.type === "object" && !!i.rowOf,
  );
  // A declared row-model input WINS over a same-named filter token — one
  // control (the source-rows dropdown), not two {category} rows.
  for (const input of rowInputs) candidates.delete(input.name);
  // The menu's OTHER primitive inputs (e.g. category_name, passed by the
  // calling menu at runtime) preview as free text — titles/lore render them
  // even though no filter enumerates their values.
  const freeInputs = (menu.contextInputs ?? []).filter(
    (i): i is Extract<ContextInput, { kind: "primitive" }> =>
      i.kind === "primitive" &&
      i.type !== "player" &&
      !candidates.has(i.name) &&
      !rowInputs.includes(i),
  );
  // A live server source is reason enough to show this section even with no args
  // to pick: per-player sources are fetched with `player = null` and render empty
  // until someone is named.
  const hasServerSource = (menu.contextInputs ?? []).some(
    (i) => i.kind === "sourceRef" && !String(i.ref).startsWith("pack:"),
  );
  if (
    candidates.size === 0 &&
    freeInputs.length === 0 &&
    rowInputs.length === 0 &&
    callContexts.length === 0 &&
    !hasServerSource
  )
    return null;

  return (
    <div className="flex flex-col gap-1.5" data-testid="preview-context-section">
      <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
        {t("menuProperties.previewContext")}
      </div>
      <p className="text-[10px] text-[var(--text-faint)]">
        {t("menuProperties.previewContextHint")}
      </p>
      {hasServerSource ? (
        // biome-ignore lint/a11y/noLabelWithoutControl: the label wraps the <input> rendered by PlayerNameInput (which takes no id); Biome cannot see through the component
        <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-mut)]">
          <span className="whitespace-nowrap">{t("menuProperties.previewAsPlayer")}</span>
          {/* Committed on blur / Enter, not on every keystroke: each change refetches
              every source of the menu from the live server, and "Iban_" typed letter
              by letter would fire five useless round-trips. */}
          <PlayerNameInput
            value={playerDraft}
            onChange={setPlayerDraft}
            onCommit={setPreviewPlayer}
            placeholder={t("menuProperties.previewAsPlayerPlaceholder")}
            testId="preview-as-player"
            className="h-6 text-[11px]"
          />
        </label>
      ) : null}
      {callContexts.length > 0 ? (
        <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-mut)]">
          <span>{t("menuProperties.previewContextFrom")}</span>
          <select
            data-testid="preview-call-context"
            className="h-6 min-w-0 flex-1 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-1.5 font-mono text-[10px] text-[var(--text)]"
            value={selectedCallIdx}
            onChange={(e) => applyCallContext(Number(e.target.value))}
          >
            <option value={-1}>{t("menuProperties.previewContextPick")}</option>
            {callContexts.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: candidates are positional per render
              <option key={i} value={i}>
                {c.from} → {c.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {[...candidates.entries()].map(([token, values]) => (
        <label
          key={token}
          htmlFor={`${fieldId}-arg-${token}`}
          className="flex items-center gap-1.5 text-[10px] text-[var(--text-mut)]"
        >
          <span className="font-mono">{`{${token}}`}</span>
          {values.size > 0 ? (
            <select
              id={`${fieldId}-arg-${token}`}
              data-testid={`preview-arg-${token}`}
              className="h-6 flex-1 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-1.5 font-mono text-[10px] text-[var(--text)]"
              value={typeof previewArgs[token] === "string" ? (previewArgs[token] as string) : ""}
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
              id={`${fieldId}-arg-${token}`}
              data-testid={`preview-arg-${token}`}
              value={typeof previewArgs[token] === "string" ? (previewArgs[token] as string) : ""}
              onChange={(e) => setMenuPreviewArg(menu.id, token, e.target.value)}
              className="h-6 flex-1 px-2 py-0 font-mono text-[10px]"
            />
          )}
        </label>
      ))}
      {rowInputs.map((input) => {
        const rows = resolveSourceRef(input.rowOf!, project, snapshots);
        const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
        const current = previewArgs[input.name];
        const selectedIdx = list.findIndex((r) => JSON.stringify(r) === JSON.stringify(current));
        return (
          <label
            key={input.name}
            className="flex items-center gap-1.5 text-[10px] text-[var(--text-mut)]"
          >
            <span className="font-mono">{`{${input.name}}`}</span>
            <select
              data-testid={`preview-arg-${input.name}`}
              className="h-6 min-w-0 flex-1 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-1.5 font-mono text-[10px] text-[var(--text)]"
              value={selectedIdx}
              onChange={(e) => {
                const row = list[Number(e.target.value)];
                if (row) setMenuPreviewArg(menu.id, input.name, row);
              }}
            >
              <option value={-1}>{t("menuProperties.previewContextPick")}</option>
              {list.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional per render
                <option key={i} value={i}>
                  {String(r.name ?? r.id ?? `#${i}`)}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      {freeInputs.map((input) => (
        <label
          key={input.name}
          htmlFor={`${fieldId}-free-${input.name}`}
          className="flex items-center gap-1.5 text-[10px] text-[var(--text-mut)]"
        >
          <span className="font-mono">{`{${input.name}}`}</span>
          <Input
            id={`${fieldId}-free-${input.name}`}
            data-testid={`preview-arg-${input.name}`}
            value={
              typeof previewArgs[input.name] === "string" ? (previewArgs[input.name] as string) : ""
            }
            placeholder={input.default ?? ""}
            onChange={(e) => setMenuPreviewArg(menu.id, input.name, e.target.value)}
            className="h-6 flex-1 px-2 py-0 font-mono text-[10px]"
          />
        </label>
      ))}
    </div>
  );
}
