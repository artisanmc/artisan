import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { PackId } from "@/domain/types";
import {
  listPackBindings,
  unbindPack,
  updatePackBindingBranch,
  type PackBinding,
} from "@/lib/api/networks";
import { listBranches } from "@/lib/api/branches";
import { BindServerDialog } from "./BindServerDialog";

interface ServersPanelContentProps {
  packId: PackId;
  networkId: string;
}

/**
 * "Serveurs" tab — lists every server_key the active pack is bound to, with
 * branch + live instance count, and lets the user rebind to a different
 * branch or remove the binding entirely. Wired in workspace.$workspaceId
 * alongside Translations and Data-Sources.
 */
export function ServersPanelContent({ packId, networkId }: ServersPanelContentProps) {
  const { t } = useTranslation();
  const [bindings, setBindings] = useState<PackBinding[] | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [bindOpen, setBindOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [bs, brs] = await Promise.all([
        listPackBindings(networkId, packId),
        listBranches(networkId, packId),
      ]);
      setBindings(bs);
      setBranches(brs.map((b) => b.name));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("servers.loadError"));
    }
  }, [networkId, packId, t]);

  useEffect(() => {
    refresh();
    // Periodic refresh so the "instances connectées" badge tracks reality
    // without requiring a manual reload.
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleUnbind = async (serverKeyId: string) => {
    if (!window.confirm(t("servers.confirmUnbind"))) return;
    setBusyKey(serverKeyId);
    try {
      await unbindPack(networkId, packId, serverKeyId);
      toast.success(t("servers.unbound"));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("servers.unbindFailed"));
    } finally {
      setBusyKey(null);
    }
  };

  const handleSwitchBranch = async (serverKeyId: string, branchName: string) => {
    setBusyKey(serverKeyId);
    try {
      await updatePackBindingBranch(networkId, packId, serverKeyId, branchName);
      toast.success(t("servers.branchSwitched"));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("servers.branchSwitchFailed"));
    } finally {
      setBusyKey(null);
    }
  };

  if (bindings === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[var(--ink-mut)]">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-[13px]">{t("servers.loading")}</span>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
      <header className="flex flex-col gap-2">
        <h2
          className="display text-[22px] tracking-tight text-[var(--ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("servers.title")}
        </h2>
        <p className="text-[13px] text-[var(--ink-mut)]">{t("servers.subtitle")}</p>
      </header>

      {bindings.length === 0 ? (
        <div className="card flex flex-col items-start gap-3 p-6">
          <p className="text-[13.5px] text-[var(--ink-2)]">{t("servers.empty")}</p>
          <button type="button" onClick={() => setBindOpen(true)} className="btn btn-primary">
            <Plus className="size-[14px]" /> {t("servers.bindCta")}
          </button>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {bindings.map((b) => {
              const online = b.online;
              return (
                <li key={b.bindingId} className="card flex items-center gap-3 p-4">
                  <span
                    className="dot shrink-0"
                    style={{
                      background: online ? "var(--sage)" : "var(--ink-faint)",
                      boxShadow: online ? "0 0 8px var(--sage)" : "none",
                    }}
                    aria-label={online ? t("servers.online") : t("servers.offline")}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13.5px] font-semibold text-[var(--ink)]">
                      {b.serverKeyLabel ?? b.serverKeyId.slice(0, 12)}
                    </span>
                    <span className="mono truncate text-[11px] text-[var(--ink-faint)]">
                      {b.serverKeyId}
                    </span>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ink-mut)]">
                      <span className={online ? "badge badge-sage" : "badge"}>
                        {online ? t("servers.online") : t("servers.offline")}
                      </span>
                      {b.lastMcVersion && (
                        <span className="text-[var(--ink-faint)]">v{b.lastMcVersion}</span>
                      )}
                    </div>
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] text-[var(--ink-mut)]">
                    {t("servers.branchLabel")}
                    <select
                      className="select h-[30px] py-0 text-[12px]"
                      value={b.branchName}
                      disabled={busyKey === b.serverKeyId}
                      onChange={(e) => handleSwitchBranch(b.serverKeyId, e.target.value)}
                    >
                      {branches.length === 0 && <option>{b.branchName}</option>}
                      {branches.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleUnbind(b.serverKeyId)}
                    disabled={busyKey === b.serverKeyId}
                    className="btn btn-sm btn-danger"
                    aria-label={t("servers.unbind")}
                  >
                    <Trash2 className="size-[13px]" />
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => setBindOpen(true)}
            className="btn btn-outline self-start"
          >
            <Plus className="size-[14px]" /> {t("servers.bindCta")}
          </button>
        </>
      )}

      <BindServerDialog
        open={bindOpen}
        onOpenChange={setBindOpen}
        networkId={networkId}
        packId={packId}
        existingBindings={bindings}
        availableBranches={branches}
        onBound={refresh}
      />
    </div>
  );
}
