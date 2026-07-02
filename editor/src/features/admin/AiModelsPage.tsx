import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import {
  type AiModelDto,
  listModels,
  setDefaultModel,
  testModel,
  updateModel,
} from "@/lib/api/adminModels";
import { formatUsdFromMicro } from "@/lib/format";
import { Bot } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AiModelForm } from "./AiModelForm";
import { AiProvidersSection } from "./AiProvidersSection";
import { AiSettingsSection } from "./AiSettingsSection";

const badgeVariant = { cheap: "sage", balanced: "amber", premium: "terra" } as const;

export function AiModelsPage() {
  const { t, i18n } = useTranslation();
  const [models, setModels] = useState<AiModelDto[] | null>(null); // null = loading
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AiModelDto | null | "new">(null);

  async function refetch() {
    const m = await listModels();
    setModels(m ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    listModels().then((m) => {
      if (!cancelled) setModels(m ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = [...(models ?? [])].sort((a, b) =>
    a.displayName < b.displayName ? -1 : a.displayName === b.displayName ? 0 : 1,
  );

  async function handleSetDefault(id: string) {
    const res = await setDefaultModel(id);
    if (res.ok) {
      setModels((prev) => prev?.map((m) => ({ ...m, isDefault: m.id === id })) ?? prev);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const res = await testModel(id);
      if (res.ok) {
        toast.success(
          t("admin.ai.models.testOk", {
            latency: res.latencyMs,
            credits: res.creditsCost,
            cost: formatUsdFromMicro(res.realCostMicroUsd ?? 0, i18n.language),
          }),
        );
      } else {
        toast.error(t("admin.ai.models.testFail", { error: res.error ?? "?" }));
      }
    } finally {
      setTestingId(null);
    }
  }

  async function handleToggleActive(model: AiModelDto) {
    const res = await updateModel(model.id, { isActive: !model.isActive });
    if (res.ok) {
      setModels(
        (prev) =>
          prev?.map((m) => (m.id === model.id ? { ...m, isActive: !model.isActive } : m)) ?? prev,
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="display text-[32px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("admin.ai.models.title")}
          </h1>
          <p className="text-[13.5px] text-[var(--text-mut)]">{t("admin.ai.models.subtitle")}</p>
        </div>
        <Button type="button" variant="primary" size="sm" onClick={() => setEditing("new")}>
          {t("admin.ai.models.new")}
        </Button>
      </div>

      {models && models.length === 0 ? (
        <EmptyState icon={Bot} title={t("admin.ai.models.empty")} className="h-auto py-16" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{t("admin.ai.models.columns.name")}</TH>
              <TH>{t("admin.ai.models.columns.provider")}</TH>
              <TH>{t("admin.ai.models.columns.badge")}</TH>
              <TH align="right">{t("admin.ai.models.columns.creditsIn")}</TH>
              <TH align="right">{t("admin.ai.models.columns.creditsOut")}</TH>
              <TH align="right">{t("admin.ai.models.columns.realCost")}</TH>
              <TH>{t("admin.ai.models.columns.active")}</TH>
              <TH>{t("admin.ai.models.columns.default")}</TH>
              <TH align="right">{t("admin.ai.models.columns.actions")}</TH>
            </TR>
          </THead>
          <TBody>
            {sorted.map((m) => (
              <TR key={m.id}>
                <TD>
                  <div className="flex flex-col">
                    <span className="font-medium text-[var(--text)]">{m.displayName}</span>
                    {m.description && (
                      <span className="text-[11.5px] text-[var(--text-faint)]">
                        {m.description}
                      </span>
                    )}
                  </div>
                </TD>
                <TD>{m.provider}</TD>
                <TD>
                  <Badge variant={badgeVariant[m.badge]}>
                    {t(`admin.ai.models.badge.${m.badge}`)}
                  </Badge>
                </TD>
                <TD align="right">{m.creditsPerMInput}</TD>
                <TD align="right">{m.creditsPerMOutput}</TD>
                <TD align="right">{formatUsdFromMicro(m.realUsdPerMInput, i18n.language)}</TD>
                <TD>
                  <Button
                    type="button"
                    variant={m.isActive ? "primary" : "outline"}
                    size="sm"
                    onClick={() => handleToggleActive(m)}
                  >
                    {m.isActive ? t("admin.ai.models.deactivate") : t("admin.ai.models.activate")}
                  </Button>
                </TD>
                <TD>
                  {m.isDefault ? (
                    <Badge variant="sage">{t("admin.ai.models.isDefault")}</Badge>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleSetDefault(m.id)}
                    >
                      {t("admin.ai.models.setDefault")}
                    </Button>
                  )}
                </TD>
                <TD align="right">
                  <div className="flex justify-end gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={testingId === m.id}
                      onClick={() => handleTest(m.id)}
                    >
                      {testingId === m.id
                        ? t("admin.ai.models.testRunning")
                        : t("admin.ai.models.test")}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(m)}>
                      {t("admin.ai.models.edit")}
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {editing !== null && (
        <AiModelForm
          open
          onClose={() => setEditing(null)}
          model={editing === "new" ? null : editing}
          onSaved={() => {
            setEditing(null);
            void refetch();
          }}
        />
      )}

      <AiProvidersSection />
      <AiSettingsSection />
    </div>
  );
}
