import { projectId } from "@/domain/ids";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { ComponentsView } from "./ComponentsView";

vi.mock("./ComponentPreview", () => ({
  ComponentPreview: ({ component, positions }: { component: string; positions: string }) => (
    <div data-testid="component-preview">{`${component}@${positions}`}</div>
  ),
}));
vi.mock("@/features/assets/AssetPicker", () => ({ AssetPicker: () => null }));

const p = projectId("p_personal");
const files = () =>
  (
    useProjectsStore.getState().openProjects.projects.find((project) => project.id === p)!
      .moduleData?.components as { __files: Record<string, string> } | undefined
  )?.__files ?? {};

beforeEach(() => useProjectsStore.setState({ openProjects: mockOpenProjects() }));

it("creates a component, gives it a parameter and a text, and deletes it", () => {
  render(<ComponentsView projectId={p} />);
  expect(screen.getByText(/Aucun composant pour l’instant/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Nouveau composant"), { target: { value: "Confirm" } });
  fireEvent.click(screen.getByRole("button", { name: "Créer" }));
  expect(parse(files()["confirm.yml"]!)).toEqual({ parts: [] });
  expect(screen.getByTestId("component-preview")).toHaveTextContent("confirm@0-2");

  fireEvent.change(screen.getByLabelText("Nouveau paramètre"), { target: { value: "text" } });
  fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));
  fireEvent.change(screen.getByLabelText("Valeur par défaut de text"), {
    target: { value: "OK" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ajouter un texte" }));
  expect(parse(files()["confirm.yml"]!)).toEqual({
    params: { text: { type: "text", default: "OK" } },
    parts: [{ label: "" }],
  });
  expect(screen.getByText("Aucun bouton de ce module ne le nomme encore.")).toBeInTheDocument();

  // Back to the list, where a name already taken is refused.
  fireEvent.click(screen.getByRole("button", { name: "Composants" }));
  fireEvent.click(screen.getByRole("button", { name: "confirm" }));
  expect(screen.getByTestId("component-preview")).toHaveTextContent("confirm@0-2");
  fireEvent.click(screen.getByRole("button", { name: "Composants" }));
  fireEvent.change(screen.getByLabelText("Nouveau composant"), { target: { value: "confirm" } });
  fireEvent.click(screen.getByRole("button", { name: "Créer" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/already exists/);

  fireEvent.click(screen.getByRole("button", { name: "confirm" }));
  fireEvent.click(screen.getByRole("button", { name: "Supprimer ce composant" }));
  expect(files()).toEqual({});
  // The list again, with nothing to open.
  expect(screen.getByText(/Aucun composant pour l’instant/)).toBeInTheDocument();
});

it("moves the piece in hand on the menu, a drag being one step of the Project's undo", () => {
  useProjectsStore.getState().writeComponent({
    projectId: p,
    name: "tag",
    content: "parts:\n  - label: under\n  - label: over\n",
  });
  render(<ComponentsView projectId={p} />);
  fireEvent.click(screen.getByRole("button", { name: "tag" }));
  const parts = () => parse(files()["tag.yml"]!).parts;
  const scene = screen.getByTestId("component-drag");
  const past = () => useProjectsStore.temporal.getState().pastStates.length;
  const before = past();

  // The piece in front is the one in hand; the menu is drawn at twice the game's pixels.
  fireEvent.pointerDown(scene, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
  fireEvent.pointerMove(scene, { clientX: 14, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(scene, { clientX: 20, clientY: 4, pointerId: 1 });
  fireEvent.pointerUp(scene, { pointerId: 1 });
  expect(parts()).toEqual([{ label: "under" }, { label: "over", offset_x: 5, offset_y: -3 }]);
  expect(past()).toBe(before + 1);

  // Another piece picked in the list is the one the arrow keys move, a pixel at a time.
  const rows = screen.getAllByTestId("part-row");
  fireEvent.click(within(rows[1]!).getByRole("button", { name: "Texte" }));
  fireEvent.keyDown(scene, { key: "ArrowDown" });
  fireEvent.keyDown(scene, { key: "ArrowLeft" });
  expect(parts()[0]).toEqual({ label: "under", offset_x: -1, offset_y: 1 });
  // Back at its anchor, the offsets are not written.
  fireEvent.keyDown(scene, { key: "ArrowUp" });
  fireEvent.keyDown(scene, { key: "ArrowRight" });
  expect(parts()[0]).toEqual({ label: "under" });
});
