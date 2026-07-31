import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "@/domain/types";
import { DataSourcesSidebar } from "./DataSourcesSidebar";

// The server-sources directory fetches; it is not what these tests are about.
vi.mock("./ServerSourcesSection", () => ({ ServerSourcesSection: () => null }));

function project(): Project {
  return {
    id: "boutique_shop",
    name: "Boutique",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [], commands: [], dialogs: [], assets: [],
    i18nKeys: {}, defaultLang: "fr", canvasLayout: {},
    dataModels: [
      { id: "boutique:category", name: "Catégorie", keyField: "id", fields: [], provenance: "module" },
      { id: "boutique:shop_settings", name: "Réglages", keyField: "id", fields: [], provenance: "module" },
      { id: "mdl_local", name: "local", keyField: "id", fields: [] },
    ],
    dataSources: [
      { id: "categories", name: "Catégories", shape: "table", modelId: "boutique:category", rows: [] },
      // Typée par une déclaration de module, comme la table — mais en Config.
      { id: "shop_settings", name: "Réglages", shape: "config", modelId: "boutique:shop_settings", fields: [], value: {} },
      { id: "ranks", name: "Grades", shape: "table", modelId: "mdl_local", rows: [] },
    ],
  } as unknown as Project;
}

function renderSidebar() {
  return render(
    <DataSourcesSidebar
      project={project()}
      selectedId={null}
      onSelect={() => {}}
      selectedServerRef={null}
      onSelectServerRef={() => {}}
    />,
  );
}

describe("DataSourcesSidebar — données possédées par un module", () => {
  // Le panneau du canvas est une surface de BINDING : une source dont le model
  // est déclaré par un module s'édite dans l'écran du module. Sinon on peut y
  // casser son schéma ou la supprimer (ADR module-config-screens).
  it("ne propose pas à l'édition une Config typée par une déclaration de module", () => {
    renderSidebar();
    const managed = screen.getByTestId("module-managed-sources");
    expect(managed.textContent).toContain("Réglages");
    expect(managed.textContent).toContain("Catégories");
  });

  it("laisse éditables les sources du project", () => {
    renderSidebar();
    expect(screen.getByTestId("module-managed-sources").textContent).not.toContain("Grades");
    expect(screen.getByRole("button", { name: /Grades/ })).toBeInTheDocument();
  });
});
