import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { I18nKey, Project } from "@/domain/types";
import { useEdgeHoverStore } from "@/state/edgeHoverStore";
import { EdgeTooltip } from "./EdgeTooltip";

const project = {
  id: "p1",
  name: "p",
  source: "user_created",
  createdAt: "",
  updatedAt: "",
  defaultLang: "en",
  i18nKeys: { ["k_sword" as I18nKey]: { en: "<red>Épée</red> du <bold>boss</bold>" } },
  documents: {
    menu: [
      {
        id: "m1",
        projectId: "p1",
        title: [],
        rows: 3,
        layers: [
          {
            id: "l1",
            name: "default",
            elements: [
              {
                id: "el1",
                display: { material: "DIAMOND_SWORD", title: { key: "k_sword" as I18nKey } },
                states: [],
              },
            ],
          },
        ],
      },
      { id: "m2", projectId: "p1", title: [], rows: 3, layers: [] },
    ],
    command: [],
    dialog: [],
  },
  assets: [],
  dataSources: [],
  importedConnectors: [],
  canvasLayout: {},
} as unknown as Project;

describe("EdgeTooltip", () => {
  beforeEach(() => {
    useEdgeHoverStore.getState().set(
      {
        id: "m1->m2",
        source: "menu/m1",
        target: "menu/m2",
        triggers: [
          { kind: "element", elementId: "el1", material: "DIAMOND_SWORD", clickType: "left" },
        ],
      },
      10,
      10,
    );
  });

  it("renders element titles as MiniMessage instead of raw markup", () => {
    render(<EdgeTooltip project={project} />);
    expect(screen.queryByText(/<red>/)).not.toBeInTheDocument();
    const segment = screen.getByText("Épée");
    expect(segment).toBeInTheDocument();
    expect(segment.style.color).toBeTruthy();
  });
});
