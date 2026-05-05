import { expect, test } from "@playwright/test";

test("canvas redesign smoke", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");

  // Index redirects to /pack/<first>; the page has now loaded the canvas route.
  await expect(page).toHaveURL(/\/pack\/p_/, { timeout: 15_000 });

  // Sidebar lists every seed pack as a mini drop target.
  await expect(page.locator("[data-pack-mini-sidebar]")).toBeVisible();
  await expect(page.locator("[data-pack-id='p_personal']")).toBeVisible();
  await expect(page.locator("[data-pack-id='p_shop_system']")).toBeVisible();
  await expect(page.locator("[data-pack-id='p_daily_quests']")).toBeVisible();

  // Konva canvas is mounted (Konva renders to a <canvas> inside the wrapper).
  await expect(page.locator("main canvas").first()).toBeVisible();

  // Right sidebar tabs are present.
  await expect(page.getByRole("tab", { name: "Properties" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Library" })).toBeVisible();

  // Click another pack mini → URL switches.
  await page.locator("[data-pack-id='p_shop_system']").click();
  await expect(page).toHaveURL(/\/pack\/p_shop_system/);
});
