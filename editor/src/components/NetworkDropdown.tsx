import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, Plus } from "lucide-react";
import { useNetworksStore } from "@/state/networksStore";
import { useSessionStore } from "@/state/sessionStore";

export function NetworkDropdown() {
  const { t } = useTranslation();
  const networks = useNetworksStore((s) => s.networks);
  const browseActiveId = useNetworksStore((s) => s.activeId);
  const setActiveId = useNetworksStore((s) => s.setActiveId);
  const sessionNetworkId = useSessionStore((s) => s.networkId);
  const [open, setOpen] = useState(false);

  // Effective active network: a live `/artisan` session wins (so the sidebar
  // always reflects the bound server), otherwise the persisted browse choice,
  // otherwise the first owned network. When the user has 0 networks we render
  // a "Create your first network" CTA instead of the picker.
  const activeId = sessionNetworkId ?? browseActiveId ?? networks?.[0]?.id ?? null;
  const active = networks?.find((n) => n.id === activeId);
  const sessionLocked = sessionNetworkId !== null;
  const otherNetworks = networks?.filter((n) => n.id !== activeId) ?? [];
  // Even when the user has only 1 network we want the dropdown to be clickable
  // so they can "+ Create network" without leaving the sidebar.
  const interactive = !sessionLocked;

  if ((networks?.length ?? 0) === 0) {
    return (
      <Link
        to="/setup"
        className="flex w-full items-center justify-between rounded-[14px] border border-dashed border-[var(--border)] bg-transparent px-3 py-2.5 text-left transition-colors hover:border-[var(--brand-line)] hover:bg-[var(--brand-soft)]"
      >
        <div className="flex flex-col">
          <span className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
            {t("sidebar.networkLabel")}
          </span>
          <span className="mt-0.5 text-[13px] font-medium text-[var(--text-mut)]">
            {t("sidebar.noNetworkCta")}
          </span>
        </div>
        <Plus className="size-3.5 text-[var(--brand)]" />
      </Link>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => interactive && setOpen((o) => !o)}
        disabled={!interactive}
        className="flex w-full items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-left transition-colors hover:border-[var(--border-strong)] disabled:hover:border-[var(--border)]"
      >
        <div className="flex flex-col">
          <span className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
            {t("sidebar.networkLabel")}
          </span>
          <span className="mt-0.5 text-[13.5px] font-medium text-[var(--text)]">
            {active?.name ?? t("sidebar.noNetworkCta")}
          </span>
        </div>
        {interactive && (
          <ChevronDown
            data-testid="network-dropdown-caret"
            className="size-3.5 text-[var(--text-mut)]"
          />
        )}
      </button>
      {open && interactive && (
        <div
          className="absolute left-0 right-0 z-10 mt-1.5 overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-raised)] p-1"
          style={{ boxShadow: "var(--shadow-md)" }}
        >
          {otherNetworks.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                setActiveId(n.id);
                setOpen(false);
              }}
              className="block w-full rounded-[10px] px-3 py-2 text-left text-[13px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            >
              {n.name}
            </button>
          ))}
          {otherNetworks.length > 0 && <div className="my-1 h-px bg-[var(--border-soft)]" />}
          <Link
            to="/setup"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[12.5px] text-[var(--brand)] transition-colors hover:bg-[var(--brand-soft)]"
          >
            <Plus className="size-3.5" />
            {t("sidebar.createNetwork")}
          </Link>
          <Link
            to="/networks"
            onClick={() => setOpen(false)}
            className="block rounded-[10px] px-3 py-2 text-left text-[12px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            {t("sidebar.manageNetworks")}
          </Link>
        </div>
      )}
    </div>
  );
}
