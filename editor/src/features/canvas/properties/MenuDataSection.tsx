import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import type { ContextInput, Menu } from "@/domain/types";
import { previewDataSource, type PreviewResult } from "@/lib/api/dataSources";
import { useNetworksStore } from "@/state/networksStore";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useServersStore } from "@/state/serversStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type SourceRefInput = Extract<ContextInput, { kind: "sourceRef" }>;

const ARG_TOKEN = /\{([a-z][a-z0-9_]*)\}/g;

/** `{arg}` tokens appearing in an input's filter/params values, deduped + sorted. */
export function extractArgTokens(input: SourceRefInput): string[] {
  const tokens = new Set<string>();
  const values = [...Object.values(input.filter ?? {}), ...Object.values(input.params ?? {})];
  for (const v of values) {
    for (const m of v.matchAll(ARG_TOKEN)) tokens.add(m[1]!);
  }
  return [...tokens].sort();
}

function summarizeShaping(input: SourceRefInput, t: (k: string) => string): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input.filter ?? {})) parts.push(`${k} = ${v}`);
  if (input.sort?.by) parts.push(`${t("menuProperties.sortLabel")} ${input.sort.by} ${input.sort.direction ?? "asc"}`);
  if (input.limit != null) parts.push(`${t("menuProperties.limitLabel")} ${input.limit}`);
  return parts.length > 0 ? parts.join(" · ") : t("menuProperties.menuDataNoFilters");
}

/** "Données du menu": one card per consumed source, live preview with the menu's filters. */
export function MenuDataSection({ menu }: { menu: Menu }) {
  const { t } = useTranslation();
  const sourceInputs = (menu.contextInputs ?? []).filter(
    (i): i is SourceRefInput => i.kind === "sourceRef" && !!i.ref,
  );
  if (sourceInputs.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="menu-data-section">
      <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
        {t("menuProperties.menuData")}
      </div>
      {sourceInputs.map((input) => (
        <MenuSourceCard key={`${input.name}:${input.ref}`} input={input} />
      ))}
    </div>
  );
}

type PreviewState = { kind: "idle" } | { kind: "loading" } | { kind: "done"; result: PreviewResult };

function MenuSourceCard({ input }: { input: SourceRefInput }) {
  const { t } = useTranslation();
  const networkId = useNetworksStore((s) => s.activeId);
  const serverId = useServersStore((s) => s.activeServerId);
  const serverSource = useServerDataSourcesStore((s) => s.sources.find((x) => x.ref === input.ref));
  const argTokens = extractArgTokens(input);
  const [testArgs, setTestArgs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const isLocal = input.ref.startsWith("pack:");

  const runPreview = async () => {
    if (!networkId || !serverId) return;
    setPreview({ kind: "loading" });
    const result = await previewDataSource(networkId, serverId, {
      ref: input.ref,
      params: input.params,
      filter: input.filter,
      sort: input.sort,
      limit: input.limit,
      args: testArgs,
    });
    setPreview({ kind: "done", result });
  };

  const errorLabel = (error: string, message: string | null): string => {
    switch (error) {
      case "server_offline": return t("dataSources.errServerOffline");
      case "fetch_timeout": return t("dataSources.errTimeout");
      case "unknown_source": return t("dataSources.errUnknownSource");
      case "player_required": return t("dataSources.errPlayerRequired");
      default: return t("dataSources.errFetchError", { message: message ?? "?" });
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)]/40 p-1.5">
      <div className="flex items-center gap-1.5">
        <span className="truncate font-mono text-xs">{input.ref}</span>
        {serverSource?.moduleId ? <Badge className="ml-auto">{serverSource.moduleId}</Badge> : null}
      </div>
      <div className="text-[10px] text-[var(--text-mut)]">{summarizeShaping(input, t)}</div>
      {isLocal ? (
        <div className="text-[10px] text-[var(--text-faint)]">{t("menuProperties.menuDataLocalHint")}</div>
      ) : (
        <>
          {argTokens.length > 0 ? (
            <div className="flex flex-col gap-1">
              {argTokens.map((token) => (
                <label key={token} className="flex items-center gap-1.5 text-[10px] text-[var(--text-mut)]">
                  <span className="font-mono">{t("menuProperties.testArgHint", { token: `{${token}}` })}</span>
                  <Input
                    data-testid={`test-arg-${token}`}
                    value={testArgs[token] ?? ""}
                    onChange={(e) => setTestArgs((prev) => ({ ...prev, [token]: e.target.value }))}
                    className="h-6 w-24 px-2 py-0 font-mono text-[10px]"
                  />
                </label>
              ))}
            </div>
          ) : null}
          <div>
            <button
              type="button"
              data-testid="menu-data-preview"
              disabled={preview.kind === "loading"}
              onClick={runPreview}
              className="rounded border border-[var(--brand)]/60 bg-[var(--brand-soft)] px-2 py-1 text-[10px] text-[var(--brand)] hover:bg-[var(--brand)]/20 disabled:opacity-50"
            >
              {preview.kind === "loading" ? t("dataSources.previewLoading") : t("dataSources.preview")}
            </button>
          </div>
          {preview.kind === "done" && preview.result.ok ? (
            <DataTable
              rows={preview.result.rows}
              truncated={preview.result.truncated}
              truncatedLabel={t("dataSources.previewTruncated")}
              emptyLabel={t("dataSources.previewEmpty")}
            />
          ) : null}
          {preview.kind === "done" && !preview.result.ok ? (
            <div className="rounded border border-[var(--warning)]/50 bg-[var(--warning-soft)] px-2 py-1 text-[10px] text-[var(--warning)]">
              {errorLabel(preview.result.error, preview.result.message)}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
