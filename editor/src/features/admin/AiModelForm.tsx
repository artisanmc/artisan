import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  type AiModelBadge,
  type AiModelDto,
  type AiModelInput,
  type ProviderDto,
  createModel,
  listProviders,
  updateModel,
} from "@/lib/api/adminModels";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const BADGES: AiModelBadge[] = ["cheap", "balanced", "premium"];

/** micro-USD (per 1M tokens) -> the dollar amount shown/edited in the form. */
const microToDollars = (micro: number): string => (micro ? String(micro / 1_000_000) : "");
/** dollar amount typed by the admin -> micro-USD stored server-side. */
const dollarsToMicro = (dollars: string): number => Math.round((Number(dollars) || 0) * 1_000_000);

export function AiModelForm({
  open,
  onClose,
  model,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  model: AiModelDto | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = model != null;

  const [displayName, setDisplayName] = useState(model?.displayName ?? "");
  const [description, setDescription] = useState(model?.description ?? "");
  const [badge, setBadge] = useState<AiModelBadge>(model?.badge ?? "balanced");
  const [provider, setProvider] = useState(model?.provider ?? "");
  const [providerModelId, setProviderModelId] = useState(model?.providerModelId ?? "");
  const [creditsIn, setCreditsIn] = useState(String(model?.creditsPerMInput ?? 0));
  const [creditsOut, setCreditsOut] = useState(String(model?.creditsPerMOutput ?? 0));
  const [usdIn, setUsdIn] = useState(microToDollars(model?.realUsdPerMInput ?? 0));
  const [usdOut, setUsdOut] = useState(microToDollars(model?.realUsdPerMOutput ?? 0));
  const [active, setActive] = useState(model?.isActive ?? true);
  const [providers, setProviders] = useState<Record<string, ProviderDto> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listProviders().then(setProviders);
  }, []);

  async function save() {
    if (busy) return;
    setBusy(true);
    const body: AiModelInput = {
      displayName,
      description,
      badge,
      provider,
      providerModelId,
      creditsPerMInput: Number(creditsIn) || 0,
      creditsPerMOutput: Number(creditsOut) || 0,
      realUsdPerMInput: dollarsToMicro(usdIn),
      realUsdPerMOutput: dollarsToMicro(usdOut),
      isActive: active,
    };
    const r = isEdit ? await updateModel(model.id, body) : await createModel(body);
    setBusy(false);
    if (r.ok) {
      toast.success(t("admin.ai.saved"));
      onSaved();
      onClose();
    } else if (r.error === "provider_key_missing") {
      toast.error(t("admin.ai.models.providerKeyMissing"));
    } else {
      toast.error(t("admin.ai.saveFail"));
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{isEdit ? t("admin.ai.models.edit") : t("admin.ai.models.new")}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <FormField label={t("admin.ai.models.form.displayName")}>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </FormField>

            <FormField label={t("admin.ai.models.form.description")}>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </FormField>

            <FormField label={t("admin.ai.models.form.badge")}>
              <select
                className="input"
                value={badge}
                onChange={(e) => setBadge(e.target.value as AiModelBadge)}
              >
                {BADGES.map((b) => (
                  <option key={b} value={b}>
                    {t(`admin.ai.models.badge.${b}`)}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label={t("admin.ai.models.form.provider")}>
              {providers ? (
                <select
                  className="input"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="" disabled>
                    …
                  </option>
                  {Object.entries(providers).map(([slug, p]) => (
                    <option key={slug} value={slug}>
                      {p.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input value={provider} onChange={(e) => setProvider(e.target.value)} />
              )}
            </FormField>

            <FormField label={t("admin.ai.models.form.providerModelId")}>
              <Input value={providerModelId} onChange={(e) => setProviderModelId(e.target.value)} />
            </FormField>

            <FormField label={t("admin.ai.models.form.creditsPerMInput")}>
              <Input
                type="number"
                value={creditsIn}
                onChange={(e) => setCreditsIn(e.target.value)}
              />
            </FormField>

            <FormField label={t("admin.ai.models.form.creditsPerMOutput")}>
              <Input
                type="number"
                value={creditsOut}
                onChange={(e) => setCreditsOut(e.target.value)}
              />
            </FormField>

            <FormField
              label={t("admin.ai.models.form.realUsdInput")}
              hint={t("admin.ai.models.form.usdHint")}
            >
              <Input
                type="number"
                step="0.01"
                value={usdIn}
                onChange={(e) => setUsdIn(e.target.value)}
              />
            </FormField>

            <FormField label={t("admin.ai.models.form.realUsdOutput")}>
              <Input
                type="number"
                step="0.01"
                value={usdOut}
                onChange={(e) => setUsdOut(e.target.value)}
              />
            </FormField>

            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="size-4 accent-[var(--brand)]"
              />
              <span className="text-[13px] font-medium text-[var(--text)]">
                {t("admin.ai.models.form.active")}
              </span>
            </label>

            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                {t("admin.ai.models.cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {t("admin.ai.models.save")}
              </Button>
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
