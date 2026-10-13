import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { rebuildServerPackInBackground } from "@/features/project/resourcePackSync";
import type { ProjectSummary } from "@/lib/api/networks";
import {
  type ServerConfig,
  ServerConfigError,
  getServerConfig,
  patchServerConfig,
} from "@/lib/api/serverConfig";
import { listAssets } from "@/lib/api/userAssets";
import { SELF_HOSTED } from "@/lib/selfHosted";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const TEXTURES = "resource-pack.container-textures.";
const SOURCE_FIELD = /^assistant\.import-sources\.([^.]+)\.([^.]+)$/;

/** Vanilla container layout: square, 256 px or an HD multiple (cf. backend vanillaGui.ts). */
const containerLayout = (w: number, h: number) => w === h && w >= 256 && w % 256 === 0;

/**
 * The server's `config.yml`, as its plugin reported it (ADR
 * `server-config-from-editor`). The plugin validates and writes; this form
 * only sends the keys that changed.
 */
export function ServerConfigSection({
  networkId,
  serverKeyId,
  projects,
}: {
  networkId: string;
  serverKeyId: string;
  projects: ProjectSummary[];
}) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ServerConfig | null | undefined>(undefined);
  const [changes, setChanges] = useState<ServerConfig>({});
  const [images, setImages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getServerConfig(networkId, serverKeyId)
      .then((res) => !cancelled && setConfig(res.config))
      .catch(() => !cancelled && setConfig(null));
    return () => {
      cancelled = true;
    };
  }, [networkId, serverKeyId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      projects.map((p) =>
        listAssets(p.id)
          .then((assets) =>
            assets
              .filter((a) => a.type !== "font" && containerLayout(a.width, a.height))
              .map((a) => `${p.externalId ?? p.id}:${a.name}`),
          )
          .catch(() => []),
      ),
    ).then((lists) => !cancelled && setImages(lists.flat().sort()));
    return () => {
      cancelled = true;
    };
  }, [projects]);

  if (config === undefined)
    return <p className="text-[13px] text-[var(--text-mut)]">{t("serverConfig.loading")}</p>;
  if (config === null)
    return <p className="text-[13px] text-[var(--text-mut)]">{t("serverConfig.unavailable")}</p>;

  const value = (key: string) => (key in changes ? changes[key] : config[key]);
  const set = (key: string, next: unknown) => {
    setError(null);
    setChanges((current) => {
      const { [key]: _, ...rest } = current;
      return JSON.stringify(next) === JSON.stringify(config[key]) ? rest : { ...rest, [key]: next };
    });
  };
  const label = (key: string) => {
    const source = SOURCE_FIELD.exec(key);
    if (source)
      return `${source[1]} · ${t(`serverConfig.sourceFields.${source[2]}`, { defaultValue: source[2] })}`;
    return t(`serverConfig.fields.${key}`, { defaultValue: key });
  };
  /** `"<key>: <code>"` from the plugin → "<label> : <explanation>". */
  const refusal = (detail: string) => {
    const [key, code] = detail.split(": ");
    return code && key
      ? t("serverConfig.refusedField", {
          field: label(key),
          reason: t(`serverConfig.errors.${code}`, { defaultValue: code }),
        })
      : t("serverConfig.refused", { detail });
  };

  const save = async () => {
    setSaving(true);
    try {
      setConfig(await patchServerConfig(networkId, serverKeyId, changes));
      setChanges({});
      // Le backend reconstruisait le pack quand les textures de conteneur changeaient.
      if (SELF_HOSTED && Object.keys(changes).some((key) => key.startsWith(TEXTURES)))
        rebuildServerPackInBackground(t, serverKeyId);
    } catch (e) {
      setError(
        e instanceof ServerConfigError && e.detail
          ? refusal(e.detail)
          : t("serverConfig.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const field = (key: string) => {
    const current = value(key);
    if (key.startsWith(TEXTURES)) {
      const options = [...new Set([...images, ...(current ? [String(current)] : [])])];
      return (
        <FormField
          key={key}
          label={label(key)}
          hint={t(`serverConfig.hints.${key.slice(TEXTURES.length)}`)}
        >
          <select
            className="input"
            value={String(current ?? "")}
            onChange={(e) => set(key, e.target.value)}
          >
            <option value="">{t("serverConfig.vanillaTexture")}</option>
            {options.map((ref) => (
              <option key={ref} value={ref}>
                {ref}
              </option>
            ))}
          </select>
        </FormField>
      );
    }
    if (typeof config[key] === "boolean")
      return (
        <div key={key} className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-[var(--text)]">{label(key)}</span>
          <Switch
            aria-label={label(key)}
            checked={current === true}
            onCheckedChange={(next) => set(key, next)}
          />
        </div>
      );
    if (typeof config[key] === "number")
      return (
        <FormField key={key} label={label(key)}>
          <Input
            type="number"
            step={1}
            value={String(current ?? "")}
            onChange={(e) =>
              set(key, e.target.value === "" ? 0 : Number.parseInt(e.target.value, 10))
            }
          />
        </FormField>
      );
    if (Array.isArray(config[key]))
      return (
        <FormField key={key} label={label(key)} hint={t("serverConfig.listHint")}>
          <Input
            value={(current as string[]).join(", ")}
            onChange={(e) =>
              set(
                key,
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </FormField>
      );
    return (
      <FormField key={key} label={label(key)}>
        <Input value={String(current ?? "")} onChange={(e) => set(key, e.target.value)} />
      </FormField>
    );
  };

  const keys = Object.keys(config);
  const groups: [string, string[]][] = [
    ["general", keys.filter((k) => !k.includes("."))],
    ["textures", keys.filter((k) => k.startsWith(TEXTURES))],
    ["resourcePack", keys.filter((k) => k.startsWith("resource-pack.") && !k.startsWith(TEXTURES))],
    ["editor", keys.filter((k) => k.startsWith("editor."))],
    ["assistant", keys.filter((k) => k.startsWith("assistant."))],
  ];
  const grouped = new Set(groups.flatMap(([, ks]) => ks));
  groups.push(["other", keys.filter((k) => !grouped.has(k))]);

  return (
    <div className="flex flex-col gap-6">
      {groups
        .filter(([, ks]) => ks.length > 0)
        .map(([group, ks]) => (
          <div key={group} className="card flex flex-col gap-3 p-4">
            <h3 className="text-[14px] font-semibold text-[var(--text)]">
              {t(`serverConfig.groups.${group}`)}
            </h3>
            {ks.map(field)}
          </div>
        ))}
      <div className="flex items-center justify-end gap-3">
        {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={saving || Object.keys(changes).length === 0}
          onClick={save}
        >
          {t("serverConfig.save")}
        </button>
      </div>
    </div>
  );
}
