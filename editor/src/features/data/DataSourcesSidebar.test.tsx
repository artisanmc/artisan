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
      // Typed by a module declaration, like the table — but as a Config.
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

describe("DataSourcesSidebar — data owned by a module", () => {
  // The canvas panel is a BINDING surface: a source whose model is declared by
  // a module is edited in the module's screen. Otherwise its schema could be
  // broken or the source deleted here (ADR module-config-screens).
  it("does not offer for editing a Config typed by a module declaration", () => {
    renderSidebar();
    const managed = screen.getByTestId("module-managed-sources");
    expect(managed.textContent).toContain("Réglages");
    expect(managed.textContent).toContain("Catégories");
  });

  it("leaves the project's sources editable", () => {
    renderSidebar();
    expect(screen.getByTestId("module-managed-sources").textContent).not.toContain("Grades");
    expect(screen.getByRole("button", { name: /Grades/ })).toBeInTheDocument();
  });
});
