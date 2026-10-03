import type { Menu, Project, ProjectId } from "@/domain/types";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { MenuCard } from "./MenuCard";

vi.mock("react-konva", () => ({
  Group: (p: { children?: ReactNode; name?: string; onClick?: () => void }) => (
    <button type="button" data-name={p.name} onClick={p.onClick}>
      {p.children}
    </button>
  ),
  Rect: () => null,
  Text: (p: { text?: string; fontSize?: number }) => <span data-font={p.fontSize}>{p.text}</span>,
}));

const PID = "p1" as ProjectId;
const menu = {
  id: "shop",
  rows: 3,
  layers: [],
  title: [{ kind: "plain", value: { key: "t" } }],
} as unknown as Menu;
const project = {
  id: PID,
  defaultLang: "fr",
  i18nKeys: { t: { fr: "<gold>Boutique" } },
  menus: [menu],
} as unknown as Project;

beforeEach(() => {
  useUiStore.setState({ centerRequest: null, activeLang: "fr" });
  useSelectionStore.getState().clear();
});

it("shows the menu's title without its formatting tags, at a readable screen size", () => {
  render(
    <MenuCard
      projectId={PID}
      project={project}
      menu={menu}
      position={{ x: 0, y: 0 }}
      scale={0.2}
    />,
  );
  const title = screen.getByText("Boutique");
  expect(Number(title.getAttribute("data-font")) * 0.2).toBeCloseTo(15);
});

it("selects the menu and centres the board on it when clicked", () => {
  render(
    <MenuCard
      projectId={PID}
      project={project}
      menu={menu}
      position={{ x: 0, y: 0 }}
      scale={0.2}
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  expect([...useSelectionStore.getState().ids]).toEqual(["shop"]);
  expect(useUiStore.getState().centerRequest).toMatchObject({ projectId: "p1", docId: "shop" });
});
