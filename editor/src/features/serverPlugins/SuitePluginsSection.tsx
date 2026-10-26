import { Badge } from "@/components/ui/badge";
import { type SuitePlugin, fetchSuitePlugins } from "@/lib/api/modules";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Artisan and the plugins built on it, as the server announces them: version, jar,
 * state, dependencies. Read-only; the jar's name is the one an update replaces.
 */
export function SuitePluginsSection({ serverKeyId }: { serverKeyId: string }) {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<SuitePlugin[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchSuitePlugins(serverKeyId).then((list) => !cancelled && setPlugins(list));
    return () => {
      cancelled = true;
    };
  }, [serverKeyId]);

  if (plugins === undefined)
    return <p className="text-[13px] text-[var(--text-mut)]">{t("suitePlugins.loading")}</p>;
  if (plugins.length === 0)
    return <p className="text-[13px] text-[var(--text-mut)]">{t("suitePlugins.unavailable")}</p>;

  return (
    <ul className="flex flex-col gap-2">
      {plugins.map((p) => (
        <li key={p.name} className="card flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[14px] font-semibold text-[var(--text)]">{p.name}</span>
            <span className="text-[12px] text-[var(--text-mut)]">{p.version}</span>
            <Badge variant={p.enabled ? "sage" : "brick"}>
              {p.enabled ? t("suitePlugins.enabled") : t("suitePlugins.disabled")}
            </Badge>
          </div>
          {p.file && (
            <span className="text-[12px] text-[var(--text-mut)]">
              {t("suitePlugins.file", { file: p.file })}
            </span>
          )}
          {p.depends.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="field-label">{t("suitePlugins.depends")}</span>
              {p.depends.map((d) => (
                <span key={d} className="chip">
                  {d}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
