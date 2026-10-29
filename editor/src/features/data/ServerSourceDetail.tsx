import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import type { ProjectId } from "@/domain/types";
import {
  type PreviewResult,
  type ServerDataSource,
  previewDataSource,
} from "@/lib/api/dataSources";
import { listServers } from "@/lib/api/servers";
import { copyText } from "@/lib/clipboard";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface ServerSourceDetailProps {
  serverId: string;
  source: ServerDataSource;
  /** Kept for call-site compat; item sets live at the MENU level. */
  projectId?: ProjectId;
}

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; result: PreviewResult };

/** Detail view of one server data source: schema table, copyable ref, live preview. */
export function ServerSourceDetail({ serverId, source }: ServerSourceDetailProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [online, setOnline] = useState<boolean | null>(null);

  // source.ref isn't read in the effect body, but it must stay in the deps
  // below so switching to a different source resets the stale preview.
  // biome-ignore lint/correctness/useExhaustiveDependencies: source.ref intentionally forces a reset on source switch
  useEffect(() => {
    setPreview({ kind: "idle" });
    let cancelled = false;
    listServers()
      .then((servers) => {
        if (cancelled) return;
        setOnline(servers.find((s) => s.id === serverId)?.online ?? false);
      })
      .catch(() => {
        if (!cancelled) setOnline(null); // unknown — leave preview enabled, errors surface on click
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, source.ref]);

  const runPreview = async () => {
    setPreview({ kind: "loading" });
    const result = await previewDataSource(serverId, { ref: source.ref });
    setPreview({ kind: "done", result });
  };

  const copyRef = async () => {
    await copyText(source.ref);
    toast.success(t("dataSources.refCopied"));
  };

  const errorLabel = (error: string, message: string | null): string => {
    switch (error) {
      case "server_offline":
        return t("dataSources.errServerOffline");
      case "fetch_timeout":
        return t("dataSources.errTimeout");
      case "unknown_source":
        return t("dataSources.errUnknownSource");
      case "player_required":
        return t("dataSources.errPlayerRequired");
      default:
        return t("dataSources.errFetchError", { message: message ?? "?" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm">{source.ref}</span>
        <button
          type="button"
          onClick={copyRef}
          title={t("dataSources.copyRef")}
          className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        >
          {t("dataSources.copyRef")}
        </button>
        <Badge className="ml-auto">{source.moduleId ?? t("dataSources.serverGroup")}</Badge>
      </div>

      <section>
        <div className="eyebrow mb-1">{t("dataSources.schemaTitle")}</div>
        {source.schema.length === 0 ? (
          <p className="text-[11px] text-[var(--text-faint)]">
            {source.schemaHint ?? t("dataSources.noSchema")}
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t("dataSources.schemaField")}</TH>
                <TH>{t("dataSources.schemaType")}</TH>
                <TH>{t("dataSources.schemaDescription")}</TH>
              </TR>
            </THead>
            <TBody>
              {source.schema.map((f) => (
                <TR key={f.name}>
                  <TD className="font-mono text-xs">{f.name}</TD>
                  <TD className="font-mono text-xs">{f.type}</TD>
                  <TD className="text-xs text-[var(--text-mut)]">{f.description ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div>
          <button
            type="button"
            data-testid="server-source-preview"
            disabled={online === false || preview.kind === "loading"}
            onClick={runPreview}
            className="rounded border border-[var(--brand)]/60 bg-[var(--brand-soft)] px-2.5 py-1.5 text-[11px] text-[var(--brand)] hover:bg-[var(--brand)]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {preview.kind === "loading"
              ? t("dataSources.previewLoading")
              : t("dataSources.preview")}
          </button>
        </div>
        <p className="text-[11px] text-[var(--text-faint)]">
          {t("dataSources.previewServerState")}
        </p>
        {online === false ? (
          <p data-testid="preview-offline-hint" className="text-[11px] text-[var(--text-mut)]">
            {t("dataSources.previewOffline")}
          </p>
        ) : null}
        {preview.kind === "done" && preview.result.ok ? (
          <DataTable
            rows={preview.result.rows}
            truncated={preview.result.truncated}
            truncatedLabel={t("dataSources.previewTruncated")}
            emptyLabel={t("dataSources.previewEmpty")}
            tableLabel={t("dataSources.viewTable")}
            yamlLabel={t("dataSources.viewYaml")}
          />
        ) : null}
        {preview.kind === "done" && !preview.result.ok ? (
          <div
            data-testid="preview-error"
            className="rounded border border-[var(--warning)]/50 bg-[var(--warning-soft)] px-2 py-1.5 text-[11px] text-[var(--warning)]"
          >
            {errorLabel(preview.result.error, preview.result.message)}
          </div>
        ) : null}
      </section>
    </div>
  );
}
