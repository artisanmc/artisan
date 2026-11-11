import "@/i18n";
import type { Project } from "@/domain/types";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { fireEvent, render, screen } from "@testing-library/react";
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
});
