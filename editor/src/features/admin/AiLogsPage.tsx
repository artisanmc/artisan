import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { type UsageFilters, type UsageLogDto, getUsageLogs, usageLogsCsvUrl } from "@/lib/api/adminAiUsage";
import { formatCredits, formatUsdFromMicro } from "@/lib/format";
import { ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const EMPTY_FILTERS: UsageFilters = {};

export function AiLogsPage() {
  const { t, i18n } = useTranslation();
  const [filters, setFilters] = useState<UsageFilters>(EMPTY_FILTERS);
  const [logs, setLogs] = useState<UsageLogDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<UsageLogDto | null>(null);

  async function fetchLogs(f: UsageFilters, cursor?: string) {
    try {
      const res = await getUsageLogs(f, cursor);
      if (!res) return;
      setLogs((prev) => (cursor ? [...prev, ...res.logs] : res.logs));
      setNextCursor(res.nextCursor);
    } catch (e) {
      console.warn("[admin-ai] fetch failed:", e);
      setLogs([]);
      setNextCursor(null);
    }
  }

  useEffect(() => {
    void fetchLogs(EMPTY_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter<K extends keyof UsageFilters>(key: K, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value || undefined }));
  }

  function handleApply() {
    void fetchLogs(filters);
  }

  function handleLoadMore() {
    if (!nextCursor) return;
    void fetchLogs(filters, nextCursor);
  }

  function handleExport() {
    window.open(usageLogsCsvUrl(filters), "_blank");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="display text-[32px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("admin.ai.logs.title")}
          </h1>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handleExport}>
          {t("admin.ai.logs.export")}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-[var(--text-mut)]">
          {t("admin.ai.logs.filters.user")}
          <Input value={filters.userId ?? ""} onChange={(e) => updateFilter("userId", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--text-mut)]">
          {t("admin.ai.logs.filters.model")}
          <Input value={filters.modelId ?? ""} onChange={(e) => updateFilter("modelId", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--text-mut)]">
          {t("admin.ai.logs.filters.provider")}
          <Input value={filters.provider ?? ""} onChange={(e) => updateFilter("provider", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--text-mut)]">
          {t("admin.ai.logs.filters.action")}
          <Input value={filters.actionType ?? ""} onChange={(e) => updateFilter("actionType", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--text-mut)]">
          {t("admin.ai.logs.filters.status")}
          <select
            className="input"
            value={filters.status ?? ""}
            onChange={(e) => updateFilter("status", e.target.value)}
          >
            <option value="">{t("admin.ai.logs.filters.all")}</option>
            <option value="success">{t("admin.ai.logs.status.success")}</option>
            <option value="error">{t("admin.ai.logs.status.error")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--text-mut)]">
          {t("admin.ai.logs.filters.from")}
          <Input
            type="date"
            value={filters.from?.slice(0, 10) ?? ""}
            onChange={(e) => updateFilter("from", e.target.value ? new Date(e.target.value).toISOString() : "")}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--text-mut)]">
          {t("admin.ai.logs.filters.to")}
          <Input
            type="date"
            value={filters.to?.slice(0, 10) ?? ""}
            onChange={(e) => updateFilter("to", e.target.value ? new Date(e.target.value).toISOString() : "")}
          />
        </label>
        <Button type="button" variant="primary" size="sm" onClick={handleApply}>
          {t("admin.ai.logs.filters.apply")}
        </Button>
      </div>

      {logs.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("admin.ai.logs.empty")} className="h-auto py-16" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{t("admin.ai.logs.columns.time")}</TH>
              <TH>{t("admin.ai.logs.columns.user")}</TH>
              <TH>{t("admin.ai.logs.columns.model")}</TH>
              <TH>{t("admin.ai.logs.columns.provider")}</TH>
              <TH>{t("admin.ai.logs.columns.action")}</TH>
              <TH>{t("admin.ai.logs.columns.status")}</TH>
              <TH align="right">{t("admin.ai.logs.columns.tokens")}</TH>
              <TH align="right">{t("admin.ai.logs.columns.credits")}</TH>
              <TH align="right">{t("admin.ai.logs.columns.cost")}</TH>
            </TR>
          </THead>
          <TBody>
            {logs.map((log) => (
              <TR key={log.id} className="cursor-pointer" onClick={() => setSelectedLog(log)}>
                <TD>{new Date(log.createdAt).toLocaleString(i18n.language)}</TD>
                <TD>{log.userId ?? log.serverKeyId ?? "—"}</TD>
                <TD>{log.modelName}</TD>
                <TD>{log.provider}</TD>
                <TD>{log.actionType}</TD>
                <TD>
                  <Badge variant={log.status === "error" ? "brick" : "sage"}>
                    {t(`admin.ai.logs.status.${log.status}`)}
                  </Badge>
                </TD>
                <TD align="right">
                  {formatCredits(log.inputTokens, i18n.language)} / {formatCredits(log.outputTokens, i18n.language)}
                </TD>
                <TD align="right">{formatCredits(log.creditsCharged, i18n.language)}</TD>
                <TD align="right">{formatUsdFromMicro(log.realCostMicroUsd, i18n.language)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {nextCursor && (
        <Button type="button" variant="outline" size="sm" onClick={handleLoadMore}>
          {t("admin.ai.logs.loadMore")}
        </Button>
      )}

      <Dialog open={selectedLog != null} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.ai.logs.detail.preview")}</DialogTitle>
          </DialogHeader>
          <DialogDescription>{selectedLog?.promptPreview}</DialogDescription>
          {selectedLog?.errorMessage && (
            <div className="flex flex-col gap-1">
              <span className="eyebrow">{t("admin.ai.logs.detail.error")}</span>
              <p className="text-[13px] text-[var(--danger)]">{selectedLog.errorMessage}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
