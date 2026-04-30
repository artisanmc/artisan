import { expect, test } from "@playwright/test";

test("3-level navigation smoke", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");

  // TanStack Router hydrates async, so wait for the home shell.
  await expect(page.getByText("Packs")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Personal")).toBeVisible();
  await expect(page.getByText("Shop System")).toBeVisible();
  await expect(page.getByText("Daily Quests")).toBeVisible();

  await page.getByText("Personal").click();
  await expect(page).toHaveURL(/\/pack\/p_personal/);
  // 3 menus + 1 command = 4 nodes (m_shop_main, m_profile, m_about, c_heal)
  await expect(page.locator(".react-flow__node")).toHaveCount(4);

  // Substring matching would also hit the "m_profile" id label inside the node;
  // exact match clicks just the menu title.
  await page.getByText("Profil", { exact: true }).click();
  await expect(page).toHaveURL(/\/pack\/p_personal\/menu\/m_profile/);
  await expect(page.getByText("Palette · Vanilla")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Properties")).toBeVisible();
});
