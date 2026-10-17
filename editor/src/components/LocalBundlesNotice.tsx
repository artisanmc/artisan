import { useModulesStore } from "@/state/modulesStore";
import { useTranslation } from "react-i18next";

/**
 * Says which modules' editor views come from a file on the server's disk (`dev.editor-bundles`
 * in environment.yml) rather than their jar: a development setting nobody should forget is on.
 */
export function LocalBundlesNotice() {
  const { t } = useTranslation();
  const local = useModulesStore((s) =>
    Object.entries(s.origins)
      .filter(([, origin]) => origin === "local")
      .map(([id]) => id)
      .join(", "),
  );
  if (!local) return null;
  return (
    <output className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] block px-3 py-1 text-[12px] text-[var(--warning)]">
      {t("localBundles.notice", { modules: local })}
    </output>
  );
}
