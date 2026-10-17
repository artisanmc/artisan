import type { Project } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ItemEditorProps } from "../ItemEditor";
import { ItemSpecField } from "./ItemSpecField";

vi.mock("../ItemEditor", () => ({
  ItemEditor: ({ onText, details }: ItemEditorProps) => (
    <div>
      <button type="button" onClick={() => onText("title", "<red>Rod")}>
        title
      </button>
      <button type="button" onClick={() => onText("lore", "one\ntwo")}>
        lore
      </button>
      {details}
    </div>
  ),
}));

beforeEach(() => {
  const project = {
    id: "p",
    defaultLang: "en",
    capturedItems: [],
    lang: {},
  } as unknown as Project;
  useProjectsStore.setState({
    openProjects: { projects: [project], projectOrder: [project.id] },
  } as never);
});

it("keeps the item's text literal, lore as lines", () => {
  const onChange = vi.fn();
  render(<ItemSpecField projectId="p" value={{ material: "FISHING_ROD" }} onChange={onChange} />);
  fireEvent.click(screen.getByText("title"));
  expect(onChange).toHaveBeenLastCalledWith({ material: "FISHING_ROD", title: "<red>Rod" });
  fireEvent.click(screen.getByText("lore"));
  expect(onChange).toHaveBeenLastCalledWith({ material: "FISHING_ROD", lore: ["one", "two"] });
});

it("ticks the item's criteria by default, each with its value, and unticking one writes the list", () => {
  const onMatch = vi.fn();
  render(
    <ItemSpecField
      projectId="p"
      value={{ material: "FISHING_ROD", enchants: { lure: 3 } }}
      onChange={() => {}}
      onMatchChange={onMatch}
    />,
  );
  const enchants = screen.getByRole("checkbox", { name: /enchant.*lure iii/i });
  expect(enchants).toBeChecked();
  expect(screen.queryByRole("checkbox", { name: /same material|même matériau/i })).toBeNull();
  expect(screen.getByText("FISHING_ROD")).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: /(refuse|refuser les) items? custom|refuse custom/i }),
  ).toBeChecked();
  expect(screen.queryByRole("checkbox", { name: /no custom name|sans nom/i })).toBeNull();
  fireEvent.click(enchants);
  expect(onMatch).toHaveBeenLastCalledWith(["material", "custom_item", "damage"]);
});

it("folds the criteria the item has nothing for", () => {
  const onMatch = vi.fn();
  render(
    <ItemSpecField
      projectId="p"
      value={{ material: "DIAMOND" }}
      onChange={() => {}}
      onMatchChange={onMatch}
    />,
  );
  expect(screen.queryByRole("checkbox", { name: /enchant/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /more criteria|plus de critères/i }));
  fireEvent.click(screen.getByRole("checkbox", { name: /no custom name|sans nom/i }));
  expect(onMatch).toHaveBeenLastCalledWith(["material", "custom_item", "name", "damage"]);
});

it("opens the folded criteria a saved match ticks", () => {
  render(
    <ItemSpecField
      projectId="p"
      value={{ material: "DIAMOND" }}
      match={["material", "lore"]}
      onChange={() => {}}
      onMatchChange={() => {}}
    />,
  );
  expect(screen.getByRole("checkbox", { name: /no lore|sans lore/i })).toBeChecked();
});

it("switches to an exact copy and back to the criteria", () => {
  const onMatch = vi.fn();
  const { rerender } = render(
    <ItemSpecField
      projectId="p"
      value={{ material: "FISHING_ROD" }}
      match={["material", "name"]}
      onChange={() => {}}
      onMatchChange={onMatch}
    />,
  );
  fireEvent.mouseDown(screen.getByRole("tab", { name: /exact/i }));
  expect(onMatch).toHaveBeenLastCalledWith(["exact"]);
  rerender(
    <ItemSpecField
      projectId="p"
      value={{ material: "FISHING_ROD" }}
      match={["exact", "material"]}
      onChange={() => {}}
      onMatchChange={onMatch}
    />,
  );
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.mouseDown(screen.getByRole("tab", { name: /criteria|selon/i }));
  expect(onMatch).toHaveBeenLastCalledWith(["material"]);
});

it("offers to go back to the default once the module chose", () => {
  const onMatch = vi.fn();
  render(
    <ItemSpecField
      projectId="p"
      value={{ material: "FISHING_ROD" }}
      match={["exact"]}
      onChange={() => {}}
      onMatchChange={onMatch}
    />,
  );
  expect(screen.getByRole("tab", { name: /exact/i })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("button", { name: /default|défaut/i }));
  expect(onMatch).toHaveBeenLastCalledWith(undefined);
});
