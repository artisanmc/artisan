import "@/i18n";
import type { Project } from "@/domain/types";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { useDocumentTrailStore } from "@/state/documentTrailStore";
import { useModulesStore } from "@/state/modulesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { registerModule } from "@artisan/editor-sdk";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ProjectScreenView } from "./ProjectScreenView";

const base = "plugins/Artisan/projects/boutique_addon";

function folder(): Project {
  return projectFromFiles("boutique_addon" as never, {
    [`${base}/manifest.yaml`]: "schema: manifest/v1\ndefault_lang: fr\nlanguages: [fr]\n",
    [`${base}/data/shop_settings.yaml`]: "whole_shop_discount: 10\n",
  });
}

beforeEach(() => {
  useModulesStore.setState({ status: "ready", mountedIds: [] });
  useProjectsStore.setState({
    openProjects: { projects: [folder()], projectOrder: [] },
  } as never);
  useServerScreensStore.setState({
    screens: [
      {
        id: "boutique:settings",
        moduleId: "boutique",
        label: "Réglages",
        table: "data/shop_settings",
        projectId: "boutique_addon",
      },
    ],
  } as never);
});

describe("ProjectScreenView — a module screen opened in its folder", () => {
  it("edits the folder's own source, with no Save button: the draft and Deploy take it", () => {
    render(
      <ProjectScreenView projectId={"boutique_addon" as never} screenId="boutique:settings" />,
    );
    expect(screen.getByRole("heading", { name: "Réglages" })).toBeTruthy();
    expect(screen.getByTestId("config-value-form")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /enregistr|save/i })).toBeNull();
    const input = screen.getByDisplayValue("10");
    fireEvent.change(input, { target: { value: "25" } });
    const source = useProjectsStore
      .getState()
      .openProjects.projects[0]!.dataSources.find((d) => d.id === "shop_settings");
    expect((source as { value: Record<string, unknown> }).value.whole_shop_discount).toBe(25);
  });

  it("switches to its file's YAML from the topbar, like a Document", () => {
    render(
      <ProjectScreenView projectId={"boutique_addon" as never} screenId="boutique:settings" />,
    );
    const yaml = useDocumentTrailStore.getState().trail?.yaml;
    expect(useDocumentTrailStore.getState().trail?.label).toBe("Réglages");
    expect(yaml?.path).toBe("data/shop_settings.yml");
    act(() => yaml!.toggle());
    expect(screen.getByTestId("source-yaml")).toBeTruthy();
    expect(screen.queryByTestId("config-value-form")).toBeNull();
    expect(useDocumentTrailStore.getState().trail?.yaml?.on).toBe(true);
  });

  it("refuses a screen of another folder", () => {
    useServerScreensStore.setState({
      screens: [
        {
          id: "daily:rewards",
          moduleId: "daily",
          label: "Récompenses",
          table: "data/rewards",
          projectId: "daily_config",
        },
      ],
    } as never);
    render(<ProjectScreenView projectId={"boutique_addon" as never} screenId="daily:rewards" />);
    expect(screen.queryByTestId("config-value-form")).toBeNull();
  });

  it("waits for an add-on's view that is still loading, then shows it, never the generated form", () => {
    useServerScreensStore.setState({
      screens: [
        {
          id: "boutique:settings",
          moduleId: "late_addon",
          label: "Réglages",
          table: "data/shop_settings",
          projectId: "boutique_addon",
          component: "grid",
        },
      ],
    } as never);
    useModulesStore.setState({ status: "loading", mountedIds: [] });
    render(
      <ProjectScreenView projectId={"boutique_addon" as never} screenId="boutique:settings" />,
    );
    expect(screen.queryByTestId("config-value-form")).toBeNull();

    // The server's bundle mounts after the first render (a reload straight on the screen).
    act(() => {
      registerModule({
        id: "late_addon",
        displayName: "Late",
        schemaVersion: "late/v1",
        sidebar: { icon: () => null, label: "Late", to: "/m/late_addon" },
        routes: [],
        screens: { grid: () => <div data-testid="addon-grid" /> },
      } as never);
      useModulesStore.setState({ status: "ready", mountedIds: ["late_addon"] });
    });
    expect(screen.getByTestId("addon-grid")).toBeTruthy();
    expect(screen.queryByTestId("config-value-form")).toBeNull();
  });

  it("falls back to the generated form once the modules failed to load", () => {
    useServerScreensStore.setState({
      screens: [
        {
          id: "boutique:settings",
          moduleId: "missing_addon",
          label: "Réglages",
          table: "data/shop_settings",
          projectId: "boutique_addon",
          component: "grid",
        },
      ],
    } as never);
    useModulesStore.setState({ status: "failed", mountedIds: [] });
    render(
      <ProjectScreenView projectId={"boutique_addon" as never} screenId="boutique:settings" />,
    );
    expect(screen.getByTestId("config-value-form")).toBeTruthy();
  });
});
