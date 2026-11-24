import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  type AiCloud,
  type AiSettings,
  type AiSettingsInput,
  deleteAiSettings,
  getAiCloud,
  getAiSettings,
  saveAiSettings,
} from "@/lib/api/ai";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/cx";
import { resetAiStatus } from "@/state/aiStatus";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Known addresses, one click away: the vendors whose compatible APIs the assistant was tried
 * against. Empty: the API's own vendor.
 */
const PRESETS: Record<string, { id: string; url: string }[]> = {
  anthropic: [
    { id: "anthropic", url: "" },
    { id: "deepseek", url: "https://api.deepseek.com/anthropic" },
  ],
  openai: [
    { id: "openai", url: "" },
    { id: "deepseek", url: "https://api.deepseek.com" },
    { id: "mistral", url: "https://api.mistral.ai/v1" },
    { id: "openrouter", url: "https://openrouter.ai/api/v1" },
    { id: "ollama", url: "http://localhost:11434/v1" },
  ],
};

/** artisanmc.net's models, on the linked account's credits: no key, no address. */
const CLOUD = "artisan";

const DEFAULT_URL: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
};

/** The image model's fields; `provider` empty: none. */
interface ImageForm {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  dailyLimit: string;
}

type Form = Required<Omit<AiSettingsInput, "maxSteps" | "image">> & {
  maxSteps: string;
  image: ImageForm;
};

const formOf = (s: AiSettings): Form => ({
  provider: s.provider ?? s.providers[0] ?? "anthropic",
  model: s.model || s.defaultModel,
  effort: s.effort,
  maxSteps: String(s.maxSteps),
  baseUrl: s.baseUrl,
  apiKey: "",
  image: {
    provider: s.image?.provider ?? "",
    model: s.image?.model ?? "",
    baseUrl: s.image?.baseUrl ?? "",
    apiKey: "",
    dailyLimit: String(s.image?.dailyLimit ?? 40),
  },
});

/**
 * The editor assistant's model and key, for those who may configure the hub (ADR
 * `editor-assistant`). Saved in the suite database, applied at once, the same for every
 * server of the network. environment.yml's `ai` section wins: then it is shown read-only.
 * Below it, the image model `generate_image` asks (design `design-ia-menus-assets`): it may be
 * set alone, for the AI apps, the assistant left without a key.
 */
export function AssistantSettingsSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AiSettings | null | undefined>(undefined);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** The site's models, asked once the `artisan` API is picked; null: could not be read. */
  const [cloud, setCloud] = useState<AiCloud | null | undefined>(undefined);
  const cloudPicked = form?.provider === CLOUD;

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

  useEffect(() => {
    if (!cloudPicked || cloud !== undefined) return;
    getAiCloud()
      .then(setCloud)
      .catch(() => setCloud(null));
  }, [cloudPicked, cloud]);

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
  const setImage = (patch: Partial<ImageForm>) => set({ image: { ...form.image, ...patch } });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const apiKey = form.apiKey.trim();
    const imageKey = form.image.apiKey.trim();
    const image = form.image.provider
      ? {
          provider: form.image.provider,
          model: form.image.model.trim(),
          baseUrl: form.image.baseUrl.trim(),
          dailyLimit: Number.parseInt(form.image.dailyLimit, 10),
          ...(imageKey ? { apiKey: imageKey } : {}),
        }
      : null;
    // An image model alone: the assistant has no key, so the hub is told of no assistant.
    const assistantSet = cloudPicked || !!apiKey || !!settings.keyHint || !image;
    void run(() =>
      saveAiSettings({
        ...(settings.image ? { image } : {}),
        provider: assistantSet ? form.provider : "",
        model: form.model.trim(),
        effort: form.effort,
        maxSteps: Number.parseInt(form.maxSteps, 10),
        baseUrl: cloudPicked ? "" : form.baseUrl.trim(),
        ...(apiKey && !cloudPicked ? { apiKey } : {}),
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
        {settings.image?.enabled && settings.image.provider && (
          <>
            {" "}
            {t("ai.settings.image.on", {
              model:
                settings.image.model ||
                settings.imageDefaultModels?.[settings.image.provider] ||
                "",
            })}
          </>
        )}
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
            onChange={(provider) =>
              // Claude's name means nothing to another API: the model is asked again.
              set({
                provider,
                baseUrl: "",
                model:
                  provider === CLOUD || form.provider === CLOUD
                    ? ""
                    : provider !== "anthropic" && form.model === settings.defaultModel
                      ? ""
                      : form.model,
              })
            }
          />
        </FormField>
        {cloudPicked ? (
          <CloudModels cloud={cloud} model={form.model} onPick={(model) => set({ model })} />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <FormField
                label={t("ai.settings.baseUrl")}
                hint={t(`ai.settings.baseUrlHints.${form.provider}`, {
                  defaultValue: t("ai.settings.baseUrlHint"),
                })}
              >
                <Input
                  value={form.baseUrl}
                  placeholder={DEFAULT_URL[form.provider] ?? ""}
                  inputMode="url"
                  maxLength={300}
                  onChange={(e) => set({ baseUrl: e.target.value })}
                />
              </FormField>
              {(PRESETS[form.provider] ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(PRESETS[form.provider] ?? []).map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={cn("chip text-[12px]", form.baseUrl === preset.url && "is-active")}
                      aria-pressed={form.baseUrl === preset.url}
                      onClick={() => set({ baseUrl: preset.url })}
                    >
                      {t(`ai.settings.vendors.${preset.id}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <FormField label={t("ai.settings.model")} hint={t("ai.settings.modelHint")}>
              <Input
                value={form.model}
                placeholder={
                  form.provider === "anthropic"
                    ? settings.defaultModel
                    : t("ai.settings.modelExamples")
                }
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
          </>
        )}
        {/* Only Anthropic's API takes it: a compatible API leaves the model's own default. */}
        {(form.provider === "anthropic" ||
          (cloudPicked &&
            cloud?.linked &&
            cloud.models.find((m) => m.id === form.model)?.protocol === "anthropic")) && (
          <FormField group label={t("ai.settings.effort")} hint={t("ai.settings.effortHint")}>
            <Segmented
              label={t("ai.settings.effort")}
              options={settings.efforts.map((e) => ({ value: e, label: e }))}
              value={form.effort}
              onChange={(effort) => set({ effort })}
            />
          </FormField>
        )}
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
        {settings.image && (
          <>
            <div className="rule" />
            <FormField
              group
              label={t("ai.settings.image.title")}
              hint={t("ai.settings.image.help")}
            >
              <Segmented
                label={t("ai.settings.image.title")}
                options={[
                  { value: "", label: t("ai.settings.image.none") },
                  ...(settings.imageProviders ?? []).map((p) => ({
                    value: p,
                    label: t(`ai.settings.image.providers.${p}`, { defaultValue: p }),
                  })),
                ]}
                value={form.image.provider}
                // Another vendor's model and address mean nothing to this one.
                onChange={(provider) => setImage({ provider, model: "", baseUrl: "" })}
              />
            </FormField>
            {form.image.provider && (
              <>
                <FormField
                  label={t("ai.settings.image.model")}
                  hint={t("ai.settings.image.modelHint", {
                    model: settings.imageDefaultModels?.[form.image.provider] ?? "",
                  })}
                >
                  <Input
                    value={form.image.model}
                    placeholder={settings.imageDefaultModels?.[form.image.provider] ?? ""}
                    maxLength={128}
                    onChange={(e) => setImage({ model: e.target.value })}
                  />
                </FormField>
                <FormField
                  label={t("ai.settings.image.apiKey")}
                  hint={
                    settings.image.keyHint && settings.image.provider === form.image.provider
                      ? t("ai.settings.apiKeySaved", { hint: settings.image.keyHint })
                      : t("ai.settings.apiKeyHint")
                  }
                >
                  <Input
                    type="password"
                    autoComplete="off"
                    value={form.image.apiKey}
                    placeholder={settings.image.keyHint ?? ""}
                    maxLength={500}
                    onChange={(e) => setImage({ apiKey: e.target.value })}
                  />
                </FormField>
                <FormField
                  label={t("ai.settings.image.baseUrl")}
                  hint={t("ai.settings.image.baseUrlHint")}
                >
                  <Input
                    value={form.image.baseUrl}
                    inputMode="url"
                    maxLength={300}
                    onChange={(e) => setImage({ baseUrl: e.target.value })}
                  />
                </FormField>
                <FormField
                  label={t("ai.settings.image.dailyLimit")}
                  hint={t("ai.settings.image.dailyLimitHint")}
                >
                  <Input
                    type="number"
                    min={0}
                    max={10000}
                    required
                    value={form.image.dailyLimit}
                    className="w-28"
                    onChange={(e) => setImage({ dailyLimit: e.target.value })}
                  />
                </FormField>
              </>
            )}
          </>
        )}
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

/** The `artisan` API's models: artisanmc.net's catalogue, one click each. */
function CloudModels({
  cloud,
  model,
  onPick,
}: {
  cloud: AiCloud | null | undefined;
  model: string;
  onPick: (model: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const note = (text: string) => <p className="text-[13px] text-[var(--text-mut)]">{text}</p>;
  if (cloud === undefined) return note(t("ai.settings.cloudLoading"));
  if (cloud === null) return note(t("ai.settings.cloudFailed"));
  if (!cloud.linked) return note(t("ai.settings.cloudUnlinked"));
  const balance = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(
    cloud.balance,
  );
  return (
    <FormField group label={t("ai.settings.cloudModel")} hint={t("ai.settings.cloudHint")}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {cloud.models.map((m) => (
            <button
              key={m.id}
              type="button"
              className={cn("chip text-[12px]", model === m.id && "is-active")}
              aria-pressed={model === m.id}
              onClick={() => onPick(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-[var(--text-mut)]">
          {t("ai.settings.cloudBalance", { balance })}
        </p>
      </div>
    </FormField>
  );
}
