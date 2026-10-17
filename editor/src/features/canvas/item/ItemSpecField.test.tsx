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

it("ticks the item's criteria by default, and unticking one writes the list", () => {
  const onMatch = vi.fn();
  render(
    <ItemSpecField
      projectId="p"
      value={{ material: "FISHING_ROD", enchants: { lure: 3 } }}
      onChange={() => {}}
      onMatchChange={onMatch}
    />,
  );
  const enchants = screen.getByRole("checkbox", { name: /enchant/i });
  expect(enchants).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /identi/i })).not.toBeChecked();
  fireEvent.click(enchants);
  expect(onMatch).toHaveBeenLastCalledWith(["material", "damage"]);
});

it("shows the module's chosen criteria and offers to go back to the default", () => {
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
  expect(screen.getByRole("checkbox", { name: /identi/i })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /mat/i })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: /default|défaut/i }));
  expect(onMatch).toHaveBeenLastCalledWith(undefined);
});
