import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { listOnlinePlayers } from "@/lib/api/onlinePlayers";
import { cx } from "@/lib/cx";
import { useServersStore } from "@/state/serversStore";
import { UserRound, Users, X } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * A player name, offered as a picker over who is currently connected.
 *
 * Every surface that asks for a player uses this one — the canvas "preview as"
 * and the capture panel's inventory mirror — so the behaviour cannot drift
 * between them.
 *
 * The list is a **convenience, never a constraint**: the field stays free text,
 * because a name may be typed for someone who just disconnected, and because an
 * offline server (which yields an empty list) must not block editing. The button
 * beside it lists who is online, fetched again on each opening — an admin signed
 * in from the console has no name of their own to type.
 */
export function PlayerNameInput({
  value,
  onChange,
  onCommit,
  placeholder,
  className,
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Called on blur, on Enter and on a pick, with the trimmed value — for surfaces that act on commit. */
  onCommit?: (next: string) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const serverId = useServersStore((s) => s.activeServerId);
  const [players, setPlayers] = useState<string[] | null>(null);

  const refresh = useCallback(() => {
    if (!serverId) return () => {};
    let cancelled = false;
    listOnlinePlayers(serverId).then((names) => {
      if (!cancelled) setPlayers(names);
    });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  useEffect(() => refresh(), [refresh]);

  const pick = (name: string) => {
    onChange(name);
    onCommit?.(name);
  };

  return (
    <div className="flex min-w-[9rem] flex-1 items-center gap-1">
      <Input
        list={listId}
        value={value}
        placeholder={placeholder}
        data-testid={testId}
        className={cx("min-w-0 flex-1", className)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit?.(e.target.value.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <datalist id={listId}>
        {(players ?? []).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) {
            setPlayers(null);
            refresh();
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="btn btn-ghost btn-icon shrink-0"
            title={t("playerPicker.open")}
            aria-label={t("playerPicker.open")}
            data-testid={testId ? `${testId}-pick` : undefined}
          >
            <Users size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72">
          <DropdownMenuLabel>{t("playerPicker.open")}</DropdownMenuLabel>
          {players === null ? (
            <DropdownMenuItem disabled>{t("playerPicker.loading")}</DropdownMenuItem>
          ) : players.length === 0 ? (
            <DropdownMenuItem disabled>{t("playerPicker.noneOnline")}</DropdownMenuItem>
          ) : (
            players.map((name) => (
              <DropdownMenuItem key={name} onSelect={() => pick(name)}>
                <UserRound />
                <span className="truncate">{name}</span>
              </DropdownMenuItem>
            ))
          )}
          {value.trim() !== "" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => pick("")}>
                <X />
                {t("playerPicker.clear")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
