import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  Breadcrumb,
  BreadcrumbCurrent,
  BreadcrumbSwitcher,
  breadcrumbLinkClass,
} from "./breadcrumb";

it("renders a labelled trail with one separator between levels and the current level marked", () => {
  render(
    <Breadcrumb label="Fil d'Ariane">
      <a href="/n" className={breadcrumbLinkClass}>
        Primalcraft
      </a>
      <a href="/s" className={breadcrumbLinkClass}>
        Survie
      </a>
      <BreadcrumbCurrent>main</BreadcrumbCurrent>
    </Breadcrumb>,
  );
  const nav = screen.getByRole("navigation", { name: "Fil d'Ariane" });
  const items = within(nav).getAllByRole("listitem");
  expect(items.map((i) => i.textContent)).toEqual(["Primalcraft", "Survie", "main"]);
  expect(nav.querySelectorAll("svg")).toHaveLength(2);
  expect(screen.getByText("main")).toHaveAttribute("aria-current", "page");
});

it("skips empty levels", () => {
  render(
    <Breadcrumb label="Trail">
      {null}
      <BreadcrumbCurrent>main</BreadcrumbCurrent>
    </Breadcrumb>,
  );
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByRole("navigation").querySelectorAll("svg")).toHaveLength(0);
});

const servers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, label: `Server ${i}` }));

function openSwitcher(n: number, onSelect = vi.fn()) {
  render(
    <BreadcrumbSwitcher
      current="s1"
      items={servers(n)}
      onSelect={onSelect}
      searchPlaceholder="Search"
    />,
  );
  const trigger = screen.getByRole("button", { name: /Server 1/ });
  fireEvent.keyDown(trigger, { key: "Enter" });
  return onSelect;
}

it("switcher lists items and selects one, without search when few", () => {
  const onSelect = openSwitcher(3);
  expect(screen.queryByPlaceholderText("Search")).toBeNull();
  fireEvent.click(screen.getByRole("menuitem", { name: /Server 2/ }));
  expect(onSelect).toHaveBeenCalledWith("s2");
});

it("switcher filters with a search field when many items", () => {
  openSwitcher(10);
  fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "server 7" } });
  expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Server 7"]);
});
