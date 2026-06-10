import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as networksApi from "@/lib/api/networks";
import type { NetworkSummary } from "@/lib/api/networks";
import { useNetworksStore } from "@/state/networksStore";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step1Network({ state, setState }: Props) {
  const { t } = useTranslation();
  const [networks, setNetworks] = useState<NetworkSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    networksApi.listNetworks().then(setNetworks).catch(console.error);
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const n = await networksApi.createNetwork(newName.trim());
      useNetworksStore.getState().bumpRefresh(); // sync the sidebar
      setNetworks((prev) => [...prev, n]);
      setState((s) => ({ ...s, networkId: n.id }));
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2
        className="display text-[20px] text-[var(--text)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("setupWizard.step1.title")}
      </h2>

      {networks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {networks.map((n) => {
            const isActive = state.networkId === n.id;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setState((s) => ({ ...s, networkId: n.id }))}
                  className={[
                    "flex w-full items-center justify-between gap-3 rounded-[14px] border px-4 py-3 text-left transition-colors",
                    isActive
                      ? "border-[var(--brand-line)] bg-[var(--brand-soft)]"
                      : "border-[var(--border)] bg-[var(--surface-inset)] hover:border-[var(--border-strong)]",
                  ].join(" ")}
                >
                  <div className="flex flex-col">
                    <span className="text-[13.5px] font-semibold text-[var(--text)]">{n.name}</span>
                    <span className="text-[11px] text-[var(--text-faint)]">
                      {t("setupWizard.step1.tierLabel")}: {n.tier}
                    </span>
                  </div>
                  {isActive && (
                    <span className="text-[11px] font-bold uppercase tracking-[.14em] text-[var(--brand)]">
                      {t("setupWizard.selected")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="field-label">{t("setupWizard.step1.newLabel")}</span>
        <div className="flex gap-2">
          <Input
            placeholder={t("setupWizard.step1.placeholder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button variant="outline" onClick={handleCreate} disabled={creating || !newName.trim()}>
            {t("setupWizard.step1.create")}
          </Button>
        </div>
      </div>
    </div>
  );
}
