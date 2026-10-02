import type { ServerChecks } from "@/features/serverIndex/serverChecks";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeployReviewDialog } from "./DeployReviewDialog";

const changes = { before: {}, after: {} };
const noop = vi.fn();

function open(checks?: ServerChecks) {
  return render(
    <DeployReviewDialog changes={changes} checks={checks} onConfirm={noop} onCancel={noop} />,
  );
}

describe("DeployReviewDialog — cross-project checks", () => {
  it("shows nothing about other projects when no checks were computed", () => {
    open(undefined);
    expect(screen.queryByText("Contrôles entre projets")).not.toBeInTheDocument();
  });

  it("shows nothing outside a server", () => {
    open({ status: "none", issues: [], unreadable: [] });
    expect(screen.queryByText("Contrôles entre projets")).not.toBeInTheDocument();
  });

  it("confirms explicitly when the checks ran and found nothing", () => {
    open({ status: "ready", issues: [], unreadable: [] });
    expect(screen.getByText("Aucun conflit avec les autres projets.")).toBeInTheDocument();
  });

  it("lists a command conflict with the documents involved", () => {
    open({
      status: "ready",
      unreadable: [],
      issues: [
        {
          kind: "command_conflict",
          name: "craft",
          owners: [
            { namespace: "core", projectName: "Core", docId: "c1" },
            { namespace: "jobs", projectName: "Jobs", docId: "c2" },
          ],
        },
      ],
    });
    expect(
      screen.getByText("/craft est revendiquée par core:c1, jobs:c2 : le jeu n'en garde qu'une."),
    ).toBeInTheDocument();
  });

  it("lists duplicate ids and broken links", () => {
    open({
      status: "ready",
      unreadable: [],
      issues: [
        {
          kind: "duplicate_id",
          docKind: "menu",
          id: "main",
          owners: [
            { namespace: "core", projectName: "Core", docId: "main" },
            { namespace: "shop", projectName: "Shop", docId: "main" },
          ],
        },
        {
          kind: "broken_link",
          reason: "missing",
          targetId: "fantome",
          from: { docId: "accueil", docKind: "menu" },
        },
        {
          kind: "broken_link",
          reason: "ambiguous",
          targetId: "doublon",
          from: { docId: "cmd", docKind: "command" },
        },
      ],
    });
    expect(
      screen.getByText("Le menu main existe dans core:main, shop:main : le jeu n'en garde qu'un."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Menu accueil : lien vers fantome introuvable sur le serveur."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Commande cmd : lien vers doublon ambigu, plusieurs projets le définissent.",
      ),
    ).toBeInTheDocument();
  });

  it("never reads as a pass while the other projects are still loading", () => {
    open({ status: "pending", issues: [], unreadable: [] });
    expect(screen.getByText(/pas encore faits/)).toBeInTheDocument();
    expect(screen.queryByText("Aucun conflit avec les autres projets.")).not.toBeInTheDocument();
  });

  it("says the checks were skipped when the other projects cannot be read", () => {
    open({ status: "unavailable", issues: [], unreadable: [] });
    expect(screen.getByText(/n'ont pas été faits/)).toBeInTheDocument();
  });

  it("warns that the checks are incomplete when some project was unreadable", () => {
    open({ status: "ready", issues: [], unreadable: ["cassé"] });
    expect(screen.getByText(/contrôles incomplets : cassé/)).toBeInTheDocument();
    expect(screen.queryByText("Aucun conflit avec les autres projets.")).not.toBeInTheDocument();
  });

  it("does not block deploying: the confirm button stays available", () => {
    open({
      status: "ready",
      unreadable: [],
      issues: [
        {
          kind: "broken_link",
          reason: "missing",
          targetId: "x",
          from: { docId: "m", docKind: "menu" },
        },
      ],
    });
    expect(screen.getByRole("button", { name: "Déployer sur le serveur" })).toBeEnabled();
  });
});
