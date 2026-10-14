import { Input } from "@/components/ui/input";
import { listOnlinePlayers } from "@/lib/api/onlinePlayers";
import { useServersStore } from "@/state/serversStore";
import { useEffect, useId, useState } from "react";

/**
 * A player name, offered as a picker over who is currently connected.
 *
 * Every surface that asks for a player uses this one — the canvas "preview as"
 * and the capture panel's inventory mirror — so the behaviour cannot drift
 * between them.
 *
 * The list is a **convenience, never a constraint**: a native `datalist` gives
 * search for free while leaving the field free-text, because a name may be typed
 * for someone who just disconnected, and because an offline server (which yields
 * an empty list) must not block editing.
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
  /** Called on blur and on Enter, with the trimmed value — for surfaces that act on commit. */
  onCommit?: (next: string) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const listId = useId();
  const serverId = useServersStore((s) => s.activeServerId);
  const [players, setPlayers] = useState<string[]>([]);

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    listOnlinePlayers(serverId).then((names) => {
      if (!cancelled) setPlayers(names);
    });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  return (
    <>
      <Input
        list={listId}
        value={value}
        placeholder={placeholder}
        data-testid={testId}
        className={className}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit?.(e.target.value.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <datalist id={listId}>
        {players.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  );
}
