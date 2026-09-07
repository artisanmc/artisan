import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import type { ProjectId } from "@/domain/types";
import { useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { RefreshProjectButton } from "./RefreshProjectButton";
import { TopBarKebabMenu } from "./TopBarKebabMenu";

const PID = "p1" as ProjectId;

function seedDraft(dirty: boolean) {
  useProjectDraftStore.setState({
    drafts: {
      [PID]: {
        baseline: { "a.yaml": "x" },
        initialTree: { "a.yaml": "x" },
        tree: { "a.yaml": dirty ? "modifié" : "x" },
      },
    },
  } as never);
}

describe("RefreshProjectButton", () => {
  it("keeps the confirmation usable after selecting refresh from the project menu", async () => {
    seedDraft(true);
    render(
      <RefreshProjectButton
        projectId={PID}
        renderTrigger={(onRefresh) => (
          <TopBarKebabMenu
            onRefresh={onRefresh}
            onOpenProjectSettings={() => {}}
            onImport={() => {}}
            onExportZip={() => {}}
            onOpenPatterns={() => {}}
            onDelete={() => {}}
          />
        )}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "topbar.more" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "topbar.refresh" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(useProjectCacheStore.getState().reloadToken).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "topbar.refreshConfirm" }));
    expect(useProjectCacheStore.getState().reloadToken).toBe(1);
  });
  beforeEach(() => {
    useProjectDraftStore.setState({ drafts: {} } as never);
    useProjectCacheStore.setState({ reloadToken: 0 } as never);
  });

  it("sans travail en cours, actualise sans rien demander", async () => {
    render(<RefreshProjectButton projectId={PID} />);
    await userEvent.click(screen.getByRole("button", { name: "topbar.refresh" }));
    expect(useProjectCacheStore.getState().reloadToken).toBe(1);
  });

  /**
   * Écraser est bien ce qu'on attend d'un rafraîchissement — mais ce qui est
   * perdu ici n'existe nulle part ailleurs, donc jamais sans le demander.
   */
  it("avec du travail non enregistré, demande confirmation avant d'écraser", async () => {
    seedDraft(true);
    render(<RefreshProjectButton projectId={PID} />);
    await userEvent.click(screen.getByRole("button", { name: "topbar.refresh" }));

    expect(screen.getByText("topbar.refreshConfirmTitle")).toBeInTheDocument();
    expect(useProjectCacheStore.getState().reloadToken).toBe(0);

    await userEvent.click(screen.getByRole("button", { name: "topbar.refreshConfirm" }));
    expect(useProjectCacheStore.getState().reloadToken).toBe(1);
    // Le brouillon part AVANT la relecture, sinon il se réappliquerait par-dessus.
    expect(useProjectDraftStore.getState().drafts[PID]).toBeUndefined();
  });

  it("annuler ne touche ni au brouillon ni à l'affichage", async () => {
    seedDraft(true);
    render(<RefreshProjectButton projectId={PID} />);
    await userEvent.click(screen.getByRole("button", { name: "topbar.refresh" }));
    await userEvent.click(screen.getByRole("button", { name: "topbar.refreshCancel" }));

    expect(useProjectCacheStore.getState().reloadToken).toBe(0);
    expect(useProjectDraftStore.getState().drafts[PID]).toBeDefined();
  });
});
