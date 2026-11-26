import { projectId } from "@/domain/ids";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import { fireEvent, render, screen } from "@testing-library/react";
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

  // A name already taken is refused.
  fireEvent.change(screen.getByLabelText("Nouveau composant"), { target: { value: "confirm" } });
  fireEvent.click(screen.getByRole("button", { name: "Créer" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/already exists/);

  fireEvent.click(screen.getByRole("button", { name: "Supprimer ce composant" }));
  expect(files()).toEqual({});
});
