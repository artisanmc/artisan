import { getAssistantConfig, putAssistantConfig, testAssistantConfig } from "@/lib/api/adminConfig";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const PROVIDERS = ["openai", "deepseek", "mistral", "openrouter", "local"];

export function AssistantConfigForm() {
  const { t } = useTranslation();
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keySet, setKeySet] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAssistantConfig().then((c) => {
      if (!c) return;
      setProvider(c.provider);
      setBaseUrl(c.baseUrl);
      setModel(c.model);
      setKeySet(c.keySet);
    });
  }, []);

  // API key is write-only: only send it when the admin typed a new one,
  // otherwise the existing key is preserved server-side.
  const body = () => ({ provider, baseUrl, model, ...(apiKey ? { apiKey } : {}) });

  async function save() {
    setBusy(true);
    const r = await putAssistantConfig(body());
    setBusy(false);
    if (r.ok) {
      setKeySet(r.data.keySet);
      setApiKey("");
      toast.success(t("admin.ai.saved"));
    } else {
      toast.error(t("admin.ai.saveFail"));
    }
  }

  async function test() {
    setBusy(true);
    const r = await testAssistantConfig(body());
    setBusy(false);
    if (r.ok) toast.success(t("admin.ai.testOk"));
    else toast.error(t("admin.ai.testFail", { error: r.error ?? "" }));
  }

  return (
    <form
      className="flex max-w-lg flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 className="eyebrow">{t("admin.ai.heading")}</h2>

      <label className="flex flex-col">
        <span className="field-label">{t("admin.ai.provider")}</span>
        <select
          className="input"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          aria-label={t("admin.ai.provider")}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col">
        <span className="field-label">{t("admin.ai.baseUrl")}</span>
        <input
          className="input"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          aria-label={t("admin.ai.baseUrl")}
        />
      </label>

      <label className="flex flex-col">
        <span className="field-label">{t("admin.ai.model")}</span>
        <input
          className="input"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          aria-label={t("admin.ai.model")}
        />
      </label>

      <label className="flex flex-col">
        <span className="field-label">{t("admin.ai.apiKey")}</span>
        <input
          className="input"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={keySet ? t("admin.ai.keySetPlaceholder") : ""}
          aria-label={t("admin.ai.apiKey")}
          autoComplete="off"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-outline"
          disabled={busy}
          onClick={() => void test()}
        >
          {t("admin.ai.test")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t("admin.ai.save")}
        </button>
      </div>
    </form>
  );
}
