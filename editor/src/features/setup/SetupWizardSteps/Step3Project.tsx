import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as networksApi from "@/lib/api/networks";
import type { ProjectSummary } from "@/lib/api/networks";
import { useNetworksStore } from "@/state/networksStore";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step3Project({ state, setState }: Props) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!state.networkId) return;
    networksApi
      .getNetwork(state.networkId)
      // A project belongs to exactly one server_key (1:N). Scope the list to the
      // server set up in step 2 — never offer workspaces owned by other servers.
      .then((detail) => setProjects(detail.projects.filter((p) => p.serverKeyId === state.serverKeyId)))
      .catch(console.error);
  }, [state.networkId, state.serverKeyId]);

  async function handleCreate() {
    if (!newName.trim() || !state.networkId) return;
    setCreating(true);
    try {
      const p = await networksApi.createProject(state.networkId, state.serverKeyId!, newName.trim());
      useNetworksStore.getState().bumpRefresh(); // sync the sidebar
      setProjects((prev) => [...prev, p]);
      setState((s) => ({ ...s, projectId: p.id }));
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
        {t("setupWizard.step3.title")}
      </h2>

      {projects.length > 0 && (
        <ul className="flex flex-col gap-2">
          {projects.map((p) => {
            const isActive = state.projectId === p.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setState((s) => ({ ...s, projectId: p.id }))}
                  className={[
                    "flex w-full items-center justify-between gap-3 rounded-[14px] border px-4 py-3 text-left transition-colors",
                    isActive
                      ? "border-[var(--brand-line)] bg-[var(--brand-soft)]"
                      : "border-[var(--border)] bg-[var(--surface-inset)] hover:border-[var(--border-strong)]",
                  ].join(" ")}
                >
                  <span className="text-[13.5px] font-semibold text-[var(--text)]">{p.name}</span>
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
        <span className="field-label">{t("setupWizard.step3.newLabel")}</span>
        <div className="flex gap-2">
          <Input
            placeholder={t("setupWizard.step3.placeholder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button variant="outline" onClick={handleCreate} disabled={creating || !newName.trim()}>
            {t("setupWizard.step3.create")}
          </Button>
        </div>
      </div>
    </div>
  );
}
