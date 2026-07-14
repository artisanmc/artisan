import { Badge } from "@/components/ui/badge";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useTranslation } from "react-i18next";
import { groupServerSources } from "./serverSourceGroups";

interface ServerSourcesSectionProps {
  selectedRef: string | null;
  onSelect: (ref: string) => void;
}

/** Sidebar section listing server-declared sources, grouped by owning module. */
export function ServerSourcesSection({ selectedRef, onSelect }: ServerSourcesSectionProps) {
  const { t } = useTranslation();
  const sources = useServerDataSourcesStore((s) => s.sources);
  const groups = groupServerSources(sources);

  return (
    <section>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
        {t("dataSources.sectionServer")}
      </div>
      {groups.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--border-soft)] bg-[var(--surface-raised)]/40 px-2 py-2 text-[11px] text-[var(--text-faint)]">
          {t("dataSources.noServerSources")}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.moduleId ?? "__server"} className="mb-2">
            <Badge className="mb-1">{g.moduleId ?? t("dataSources.serverGroup")}</Badge>
            <ul className="flex flex-col gap-1">
              {g.sources.map((s) => (
                <li key={s.ref}>
                  <button
                    type="button"
                    onClick={() => onSelect(s.ref)}
                    className={
                      selectedRef === s.ref
                        ? "flex w-full items-center gap-1 rounded bg-[var(--surface-raised-2)] px-2 py-1 text-left text-[12px]"
                        : "flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[12px] text-[var(--text-mut)] hover:bg-[var(--surface-raised)]"
                    }
                  >
                    <span>🛰</span>
                    <span className="truncate font-mono">{s.ref}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
