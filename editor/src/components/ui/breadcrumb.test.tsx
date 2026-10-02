import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { Breadcrumb, BreadcrumbCurrent, breadcrumbLinkClass } from "./breadcrumb";

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
