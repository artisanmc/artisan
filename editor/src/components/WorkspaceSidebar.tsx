import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { NetworkDropdown } from "./NetworkDropdown";
import { useSessionStore } from "@/state/sessionStore";
import { getNetwork, type PackSummary } from "@/lib/api/networks";

export function WorkspaceSidebar() {
  const networkId = useSessionStore((s) => s.networkId);
  const [packs, setPacks] = useState<PackSummary[]>([]);

  useEffect(() => {
    if (!networkId) {
      setPacks([]);
      return;
    }
    let cancelled = false;
    getNetwork(networkId)
      .then((d) => {
        if (!cancelled) setPacks(d.packs);
      })
      .catch(() => {
        if (!cancelled) setPacks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [networkId]);

  const sorted = [...packs].sort((a, b) =>
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  );

  return (
    <nav className="flex h-full flex-col gap-3 p-2">
      <NetworkDropdown />

      <div>
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
          Mes Workspaces
        </div>
        <ul className="flex flex-col gap-0.5">
          {sorted.map((w) => (
            <li key={w.id}>
              {/* @ts-expect-error route /pack/$packId exists; will update to /workspace/$workspaceId at Task C3 */}
              <Link
                to="/pack/$packId"
                params={{ packId: w.id }}
                className="block rounded px-2 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
                activeProps={{ className: "block rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100" }}
              >
                {w.name}
              </Link>
            </li>
          ))}
        </ul>
        {networkId && (
          <Link
            to="/networks/$networkId"
            params={{ networkId }}
            className="mt-1 block px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            + Nouveau workspace
          </Link>
        )}
      </div>

      <div>
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
          Modules installés
        </div>
        <div className="rounded border border-dashed border-zinc-800 px-2 py-2 text-[11px] text-zinc-500">
          Aucun module installé. Les plugins compatibles Interfaze (Shop, Quests, etc.) apparaîtront ici quand tu les ajouteras à ton serveur.
        </div>
      </div>
    </nav>
  );
}
