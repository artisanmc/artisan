import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Key } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  bindPackToServerKey,
  createServerKey,
  getNetwork,
  type PackBinding,
  type ServerKeySummary,
} from "@/lib/api/networks";

interface BindServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  networkId: string;
  packId: string;
  existingBindings: PackBinding[];
  availableBranches: string[];
  onBound: () => void;
}

type Mode = "pick" | "create" | "show_key";

/**
 * "Lier à un serveur" modal — mirrors the setup wizard's server-key step but
 * scoped to the active pack. The user picks an existing server_key (only those
 * not already bound to this pack on any branch) or creates a fresh one. When
 * a key is freshly minted we surface the plaintext once, then drop into the
 * branch picker before persisting the binding.
 */
export function BindServerDialog({
  open,
  onOpenChange,
  networkId,
  packId,
  existingBindings,
  availableBranches,
  onBound,
}: BindServerDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("pick");
  const [serverKeys, setServerKeys] = useState<ServerKeySummary[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [plaintextKey, setPlaintextKey] = useState<string | null>(null);
  const [branch, setBranch] = useState<string>("main");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("pick");
    setSelectedKeyId(null);
    setNewLabel("");
    setPlaintextKey(null);
    setBranch(availableBranches.includes("main") ? "main" : availableBranches[0] ?? "main");
    getNetwork(networkId)
      .then((d) => setServerKeys(d.serverKeys))
      .catch(() => setServerKeys([]));
  }, [open, networkId, availableBranches]);

  const boundIds = new Set(existingBindings.map((b) => b.serverKeyId));
  const availableKeys = serverKeys.filter((sk) => !boundIds.has(sk.id));

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    setBusy(true);
    try {
      const sk = await createServerKey(networkId, newLabel.trim());
      setSelectedKeyId(sk.id);
      setPlaintextKey(sk.key);
      setServerKeys((cur) => [...cur, { id: sk.id, label: sk.label, createdAt: new Date().toISOString() }]);
      setMode("show_key");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("servers.createKeyFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleBind = async () => {
    if (!selectedKeyId) return;
    setBusy(true);
    try {
      await bindPackToServerKey(networkId, packId, selectedKeyId, branch);
      toast.success(t("servers.bound"));
      onBound();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("servers.bindFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleCopyKey = async () => {
    if (!plaintextKey) return;
    await navigator.clipboard.writeText(plaintextKey);
    toast.success(t("servers.keyCopied"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("servers.bindDialogTitle")}</DialogTitle>
        </DialogHeader>

        {mode === "pick" && (
          <div className="flex flex-col gap-3">
            <span className="field-label">{t("servers.pickServerKey")}</span>
            {availableKeys.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {availableKeys.map((sk) => {
                  const isActive = selectedKeyId === sk.id;
                  return (
                    <li key={sk.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedKeyId(sk.id)}
                        className={[
                          "flex w-full items-center justify-between rounded-[14px] border px-4 py-3 text-left transition-colors",
                          isActive
                            ? "border-[var(--terra-line)] bg-[var(--terra-soft)]"
                            : "border-[var(--line)] bg-[var(--inset)] hover:border-[var(--line-strong)]",
                        ].join(" ")}
                      >
                        <div className="flex flex-col">
                          <span className="text-[13.5px] font-semibold text-[var(--ink)]">
                            {sk.label ?? sk.id.slice(0, 12)}
                          </span>
                          <span className="mono text-[10.5px] text-[var(--ink-faint)]">
                            {sk.id}
                          </span>
                        </div>
                        {isActive && (
                          <span className="text-[11px] font-bold uppercase tracking-[.14em] text-[var(--terra)]">
                            {t("servers.selected")}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[12.5px] text-[var(--ink-mut)]">
                {t("servers.noKeysAvailable")}
              </p>
            )}

            <div className="rule mt-1" />

            <span className="field-label">{t("servers.orCreateNew")}</span>
            <div className="flex gap-2">
              <Input
                placeholder={t("servers.keyLabelPlaceholder")}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              />
              <Button
                variant="outline"
                onClick={handleCreate}
                disabled={busy || !newLabel.trim()}
              >
                {t("servers.createKey")}
              </Button>
            </div>
          </div>
        )}

        {mode === "show_key" && plaintextKey && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Key className="size-[14px] text-[var(--gold)]" />
              <span className="field-label flex items-center gap-1">
                {t("servers.freshKey")}
                <span className="ml-1 rounded-full bg-[var(--gold-soft)] px-1.5 py-0.5 text-[9.5px] font-bold tracking-[.06em] text-[var(--gold)]">
                  {t("servers.shownOnce")}
                </span>
              </span>
            </div>
            <div className="relative">
              <code className="mono block break-all rounded-[14px] border border-[var(--line)] bg-[var(--inset)] px-3 py-3 pr-12 text-[12px] text-[var(--sand)]">
                {plaintextKey}
              </code>
              <button
                type="button"
                onClick={handleCopyKey}
                className="absolute right-1.5 top-1.5 btn btn-icon btn-sm btn-ghost"
                aria-label={t("servers.copy")}
              >
                <Copy className="size-[14px]" />
              </button>
            </div>
            <p className="text-[11.5px] leading-relaxed text-[var(--ink-mut)]">
              {t("servers.keyInstructionsHint")}
            </p>
          </div>
        )}

        {selectedKeyId && (
          <div className="mt-2 flex flex-col gap-1.5">
            <span className="field-label">{t("servers.targetBranch")}</span>
            <select
              className="select"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            >
              {availableBranches.length === 0 ? (
                <option value="main">main</option>
              ) : (
                availableBranches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))
              )}
            </select>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("servers.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={handleBind}
            disabled={busy || !selectedKeyId}
          >
            {busy ? "…" : t("servers.bindConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
