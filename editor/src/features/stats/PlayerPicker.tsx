import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type StatsPlayer, fetchStatsPlayerNames, searchStatsPlayers } from "@/lib/api/stats";
import { User, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * The player filter: every player, or one found by the start of their name among the
 * players the server has seen. The URL keeps the UUID; the name is read back from it.
 */
export function PlayerPicker({
  serverId,
  value,
  onChange,
}: {
  serverId: string;
  value: string | undefined;
  onChange: (player: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StatsPlayer[]>([]);
  const [name, setName] = useState<string>();

  useEffect(() => {
    if (!value) return setName(undefined);
    let cancelled = false;
    fetchStatsPlayerNames(serverId, [value]).then(
      (players) => !cancelled && setName(players[0]?.name),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [serverId, value]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // A short wait: a read per pause in typing, not per letter.
    const timer = setTimeout(() => {
      searchStatsPlayers(serverId, query.trim()).then(
        (players) => !cancelled && setResults(players),
        () => !cancelled && setResults([]),
      );
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [serverId, query, open]);

  return (
    <span className="inline-flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={t("stats.player.label")}
          >
            <User className="size-3.5" aria-hidden />
            {value ? (name ?? `${value.slice(0, 8)}…`) : t("stats.player.all")}
          </button>
        </PopoverTrigger>
        <PopoverContent className="flex w-64 flex-col gap-2">
          <input
            // biome-ignore lint/a11y/noAutofocus: the popover exists to type a name
            autoFocus
            className="input"
            value={query}
            maxLength={16}
            placeholder={t("stats.player.search")}
            aria-label={t("stats.player.search")}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.length === 0 ? (
            <p className="px-1 py-2 text-[12px] text-[var(--text-faint)]">
              {t("stats.player.none")}
            </p>
          ) : (
            <ul className="flex max-h-64 flex-col overflow-auto">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full rounded-[var(--r-xs)] px-2 py-1.5 text-left text-[13px] hover:bg-[var(--surface-hover)]"
                    onClick={() => {
                      onChange(p.id);
                      setName(p.name);
                      setOpen(false);
                    }}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      {value && (
        <button
          type="button"
          className="btn btn-ghost btn-sm px-1.5"
          aria-label={t("stats.player.clear")}
          title={t("stats.player.clear")}
          onClick={() => onChange(undefined)}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </span>
  );
}
