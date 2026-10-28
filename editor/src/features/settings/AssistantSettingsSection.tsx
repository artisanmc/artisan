import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { resetAiStatus } from "@/features/project/assistant/useAssistant";
import {
  type AiSettings,
  type AiSettingsInput,
  deleteAiSettings,
  getAiSettings,
  saveAiSettings,
} from "@/lib/api/ai";
import { ApiError } from "@/lib/api/client";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Form = Required<Omit<AiSettingsInput, "maxSteps">> & { maxSteps: string };

const formOf = (s: AiSettings): Form => ({
  provider: s.provider ?? s.providers[0] ?? "anthropic",
  model: s.model || s.defaultModel,
  effort: s.effort,
  maxSteps: String(s.maxSteps),
  baseUrl: s.baseUrl,
  apiKey: "",
});

/**
 * The editor assistant's model and key, for those who may configure the hub (ADR
 * `editor-assistant`). Saved in the suite database, applied at once, the same for every
 * server of the network. environment.yml's `ai` section wins: then it is shown read-only.
 */
export function AssistantSettingsSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AiSettings | null | undefined>(undefined);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const show = (s: AiSettings) => {
    setSettings(s);
    setForm(formOf(s));
  };

  useEffect(() => {
    getAiSettings()
      .then((s) => {
        setSettings(s);
        setForm(formOf(s));
      })
      .catch(() => setSettings(null));
  }, []);

  if (settings === undefined)
    return <p className="text-[13px] text-[var(--text-mut)]">{t("ai.settings.loading")}</p>;
  if (settings === null || form === null)
    return <p className="text-[13px] text-[var(--text-mut)]">{t("ai.settings.unavailable")}</p>;

  const readOnly = !settings.editable;
  const set = (patch: Partial<Form>) => {
    setForm({ ...form, ...patch });
    setSaved(false);
  };
  const run = async (action: () => Promise<AiSettings>) => {
    setBusy(true);
    setError(null);
    try {
      show(await action());
      resetAiStatus();
      setSaved(true);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "network_error";
      const field = e instanceof ApiError && e.detail ? t(`ai.settings.${e.detail}`) : "";
      setError(
        t(`ai.settings.errors.${code}`, { field, defaultValue: t("ai.settings.errors.unknown") }),
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const apiKey = form.apiKey.trim();
    void run(() =>
      saveAiSettings({
        provider: form.provider,
        model: form.model.trim(),
        effort: form.effort,
        maxSteps: Number.parseInt(form.maxSteps, 10),
        baseUrl: form.baseUrl.trim(),
        ...(apiKey ? { apiKey } : {}),
      }),
    );
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <p className="text-[13px] text-[var(--text)]">
        {readOnly
          ? t("ai.settings.fromFile")
          : settings.enabled
            ? t("ai.settings.on", { model: settings.model })
            : t("ai.settings.off")}
      </p>

      <fieldset disabled={readOnly || busy} className="flex flex-col gap-5">
        <FormField group label={t("ai.settings.provider")} hint={t("ai.settings.providerHint")}>
          <Segmented
            label={t("ai.settings.provider")}
            options={settings.providers.map((p) => ({
              value: p,
              label: t(`ai.settings.providers.${p}`, { defaultValue: p }),
            }))}
            value={form.provider}
            onChange={(provider) => set({ provider })}
          />
        </FormField>
        <FormField label={t("ai.settings.baseUrl")} hint={t("ai.settings.baseUrlHint")}>
          <Input
            value={form.baseUrl}
            placeholder="https://api.anthropic.com"
            inputMode="url"
            maxLength={300}
            onChange={(e) => set({ baseUrl: e.target.value })}
          />
        </FormField>
        <FormField label={t("ai.settings.model")} hint={t("ai.settings.modelHint")}>
          <Input
            value={form.model}
            placeholder={settings.defaultModel}
            maxLength={128}
            required
            onChange={(e) => set({ model: e.target.value })}
          />
        </FormField>
        <FormField
          label={t("ai.settings.apiKey")}
          hint={
            settings.keyHint
              ? t("ai.settings.apiKeySaved", { hint: settings.keyHint })
              : t("ai.settings.apiKeyHint")
          }
        >
          <Input
            type="password"
            autoComplete="off"
            value={form.apiKey}
            placeholder={settings.keyHint ?? "sk-…"}
            maxLength={500}
            onChange={(e) => set({ apiKey: e.target.value })}
          />
        </FormField>
        <FormField group label={t("ai.settings.effort")} hint={t("ai.settings.effortHint")}>
          <Segmented
            label={t("ai.settings.effort")}
            options={settings.efforts.map((e) => ({ value: e, label: e }))}
            value={form.effort}
            onChange={(effort) => set({ effort })}
          />
        </FormField>
        <FormField label={t("ai.settings.maxSteps")} hint={t("ai.settings.maxStepsHint")}>
          <Input
            type="number"
            min={1}
            max={100}
            required
            value={form.maxSteps}
            className="w-28"
            onChange={(e) => set({ maxSteps: e.target.value })}
          />
        </FormField>
      </fieldset>

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
          {saved && !error && (
            <p className="text-[12px] text-[var(--success)]">{t("ai.settings.saved")}</p>
          )}
          {settings.source === "database" && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() =>
                window.confirm(t("ai.settings.turnOffConfirm")) && void run(deleteAiSettings)
              }
            >
              {t("ai.settings.turnOff")}
            </button>
          )}
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {t("ai.settings.save")}
          </button>
        </div>
      )}
    </form>
  );
}
