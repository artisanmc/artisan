import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { type ProviderDto, listProviders, putProvider } from "@/lib/api/adminModels";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

async function saveProvider(
  slug: string,
  body: { label?: string; baseUrl?: string; apiKey?: string },
  t: (key: string) => string,
  onOk: () => void,
) {
  const r = await putProvider(slug, body);
  if (r.ok) {
    toast.success(t("admin.ai.providers.saved"));
    onOk();
  } else if (r.error === "encryption_not_configured") {
    toast.error(t("admin.ai.providers.encNotConfigured"));
  } else {
    toast.error(t("admin.ai.saveFail"));
  }
}

function ProviderCard({
  slug,
  provider,
  onSaved,
}: {
  slug: string;
  provider: ProviderDto;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [keySet, setKeySet] = useState(provider.keySet);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await saveProvider(slug, { baseUrl, ...(apiKey ? { apiKey } : {}) }, t, () => {
      setKeySet(keySet || apiKey !== "");
      setApiKey("");
      onSaved();
    });
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{provider.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <FormField label={t("admin.ai.providers.baseUrl")}>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </FormField>

          <FormField
            label={t("admin.ai.providers.apiKey")}
            hint={keySet ? t("admin.ai.providers.keySet") : t("admin.ai.providers.keyUnset")}
          >
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keySet ? t("admin.ai.keySetPlaceholder") : ""}
              autoComplete="off"
            />
          </FormField>

          <Button type="submit" variant="primary" size="sm" disabled={busy} className="self-start">
            {t("admin.ai.providers.save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AddCustomProviderCard({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!slug) return;
    setBusy(true);
    await saveProvider(slug, { label, baseUrl, ...(apiKey ? { apiKey } : {}) }, t, onSaved);
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.ai.providers.addCustom")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <FormField label={t("admin.ai.providers.slug")}>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
          </FormField>

          <FormField label={t("admin.ai.providers.label")}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </FormField>

          <FormField label={t("admin.ai.providers.baseUrl")}>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </FormField>

          <FormField label={t("admin.ai.providers.apiKey")}>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
          </FormField>

          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>
              {t("admin.ai.models.cancel")}
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {t("admin.ai.providers.save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function AiProvidersSection() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<Record<string, ProviderDto> | null>(null);
  const [adding, setAdding] = useState(false);

  async function refetch() {
    try {
      const p = await listProviders();
      setProviders(p ?? {});
    } catch (e) {
      console.warn("[admin-ai] fetch failed:", e);
      setProviders({});
    }
  }

  useEffect(() => {
    void refetch();
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="eyebrow">{t("admin.ai.providers.title")}</h2>
        <p className="text-[13.5px] text-[var(--text-mut)]">{t("admin.ai.providers.subtitle")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {providers &&
          Object.entries(providers).map(([slug, provider]) => (
            <ProviderCard key={slug} slug={slug} provider={provider} onSaved={refetch} />
          ))}

        {adding ? (
          <AddCustomProviderCard
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              void refetch();
            }}
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setAdding(true)}
          >
            {t("admin.ai.providers.addCustom")}
          </Button>
        )}
      </div>
    </section>
  );
}
