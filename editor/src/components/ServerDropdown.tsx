import { useEffect } from "react";
import { useServersStore } from "@/state/serversStore";

interface ServerSummary { id: string; label: string | null; }
interface Props { servers: ServerSummary[]; }

export function ServerDropdown({ servers }: Props) {
  const activeServerId = useServersStore((s) => s.activeServerId);
  const setActiveServerId = useServersStore((s) => s.setActiveServerId);

  // Auto-pick alphabetically when selection is missing or stale.
  useEffect(() => {
    if (servers.length === 0) return;
    const stillValid = servers.some((s) => s.id === activeServerId);
    if (!stillValid) {
      const sorted = [...servers].sort((a, b) =>
        (a.label ?? a.id).localeCompare(b.label ?? b.id),
      );
      setActiveServerId(sorted[0]!.id);
    }
  }, [servers, activeServerId, setActiveServerId]);

  if (servers.length < 2) return null;

  return (
    <select
      className="mono h-[34px] w-full appearance-none rounded-[10px] border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-[12px] text-[var(--text-mut)] hover:border-[var(--border-strong)]"
      value={activeServerId ?? ""}
      onChange={(e) => setActiveServerId(e.target.value)}
    >
      {servers.map((s) => (
        <option key={s.id} value={s.id}>{s.label ?? s.id.slice(0, 12)}</option>
      ))}
    </select>
  );
}
