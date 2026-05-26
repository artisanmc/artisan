import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useNetworksStore } from "@/state/networksStore";
import { useSessionStore } from "@/state/sessionStore";

export function NetworkDropdown() {
  const networks = useNetworksStore((s) => s.networks);
  const activeId = useSessionStore((s) => s.networkId);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const active = networks?.find((n) => n.id === activeId);
  const hasMultiple = (networks?.length ?? 0) > 1;

  if (!active) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => hasMultiple && setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-sm hover:bg-zinc-900"
      >
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Network</div>
          <div className="text-zinc-100">{active.name}</div>
        </div>
        {hasMultiple && (
          <span data-testid="network-dropdown-caret" className="text-zinc-500">
            ▼
          </span>
        )}
      </button>
      {open && hasMultiple && (
        <div className="absolute left-0 right-0 z-10 mt-1 rounded border border-zinc-800 bg-zinc-950 shadow-lg">
          {networks!
            .filter((n) => n.id !== activeId)
            .map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate({ to: "/networks/$networkId", params: { networkId: n.id } });
                }}
                className="block w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900"
              >
                {n.name}
              </button>
            ))}
          <Link
            to="/networks"
            onClick={() => setOpen(false)}
            className="block border-t border-zinc-800 px-3 py-2 text-left text-xs text-zinc-400 hover:bg-zinc-900"
          >
            Gérer les networks →
          </Link>
        </div>
      )}
    </div>
  );
}
