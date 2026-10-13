import "@/site/i18n";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { INSTALL_URL, MarketingLayout } from "./MarketingLayout";

test("links only to the site, the wiki and the installation guide", () => {
  render(
    <MarketingLayout description="Artisan">
      <p>Page content</p>
    </MarketingLayout>,
  );
  expect(screen.getByText("Page content")).toBeVisible();
  const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href") ?? "");
  expect(hrefs).toContain(INSTALL_URL);
  expect(hrefs).toContain("/wiki/");
  for (const href of hrefs) expect(href).toMatch(/^\/(#|wiki\/|[a-z]+\.html$|$)|^#main-content$/);
});
