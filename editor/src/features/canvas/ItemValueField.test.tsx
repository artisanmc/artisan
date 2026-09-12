import { buildScratchProject, diffScratchForWrite } from "@/features/screens/screenScratch";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ItemEditorProps } from "./ItemEditor";
import { ItemValueField } from "./ItemValueField";

vi.mock("./ItemEditor", () => ({
  ItemEditor: ({ onText }: ItemEditorProps) => (
    <button
      type="button"
      onClick={() => {
        onText("title", "Sword {item.name}");
      }}
    >
      Edit title
    </button>
  ),
}));

it("saves live catalogue item text in the file even when another preview language is active", () => {
  const config = {
    id: "test:catalog",
    moduleId: "test",
    label: "Catalog",
    table: "data/items",
    projectId: "shop",
  };
  const files = [
    {
      path: "data/items.yaml",
      content:
        "schema: data/v1\nid: items\nshape: config\nfields:\n  - name: icon\n    kind: item\nvalue:\n  icon: STONE\n",
    },
  ];
  const p = buildScratchProject(config, files, []);
  useAccountStore.setState({
    account: { id: "test" as never, projects: [p], projectOrder: [p.id] },
  });
  useUiStore.setState({ activeLang: "fr" });
  const source = p.dataSources[0]!;
  if (source.shape !== "config") throw new Error("expected config");
  render(
    <ItemValueField
      projectId={p.id}
      value={source.value.icon}
      onChange={(value) =>
        useAccountStore
          .getState()
          .setSourceValue({
            projectId: p.id,
            sourceId: source.id,
            row: null,
            path: ["icon"],
            value,
          })
      }
    />,
  );
  fireEvent.click(screen.getByText("Edit title"));
  const updated = useAccountStore.getState().account.projects[0]!;
  expect(
    diffScratchForWrite(updated, config, files).files.find((f) => f.path === "data/items.yaml")
      ?.content,
  ).toContain("Sword {item.name}");
});
